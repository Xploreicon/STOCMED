'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, CheckCheck, Loader2 } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import {
  getNotificationHref,
  type InAppNotification,
} from '@/lib/notifications/in-app'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

export function NotificationInbox({ userId }: { userId: string }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const refresh = useCallback(async () => {
    const [listResult, countResult] = await Promise.all([
      supabase
        .from('notifications')
        .select('id,recipient_type,recipient_id,pharmacy_id,type,title,body,data,read_at,created_at')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null),
    ])

    const requestError = listResult.error ?? countResult.error
    if (requestError) {
      setError('Notifications could not be loaded.')
      setLoading(false)
      return
    }

    setNotifications((listResult.data ?? []) as InAppNotification[])
    setUnreadCount(countResult.count ?? 0)
    setError(null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void refresh()

    const channel = supabase
      .channel(`notification-inbox:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh, supabase, userId])

  const markRead = async (notification: InAppNotification) => {
    if (!notification.read_at) {
      const readAt = new Date().toISOString()
      setNotifications(current => current.map(item => (
        item.id === notification.id ? { ...item, read_at: readAt } : item
      )))
      setUnreadCount(current => Math.max(0, current - 1))

      const { error: markError } = await (supabase as any).rpc('mark_notification_read', {
        p_notification_id: notification.id,
      })
      if (markError) void refresh()
    }

    const href = getNotificationHref(notification.data)
    if (href) router.push(href)
  }

  const markAllRead = async () => {
    if (unreadCount === 0 || markingAll) return
    setMarkingAll(true)
    const readAt = new Date().toISOString()
    setNotifications(current => current.map(item => (
      item.read_at ? item : { ...item, read_at: readAt }
    )))
    setUnreadCount(0)

    const { error: markError } = await (supabase as any).rpc('mark_all_notifications_read')
    if (markError) void refresh()
    setMarkingAll(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-full text-ink-muted hover:bg-primary/5 hover:text-primary"
          aria-label={unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'}
        >
          <Bell className="h-[19px] w-[19px]" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <p className="text-xs text-ink-muted">
              {unreadCount === 0 ? 'You are all caught up' : `${unreadCount} unread`}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={markingAll}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
            >
              {markingAll
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto" aria-live="polite">
          {loading && <InboxLoading />}
          {!loading && error && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-ink-muted">{error}</p>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-primary"
                onClick={() => {
                  setLoading(true)
                  void refresh()
                }}
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !error && notifications.length === 0 && <InboxEmpty />}
          {!loading && !error && notifications.map(notification => {
            const href = getNotificationHref(notification.data)
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => void markRead(notification)}
                className={cn(
                  'relative block w-full border-b border-border px-4 py-3 text-left last:border-b-0',
                  'transition-colors hover:bg-surface focus:bg-surface focus:outline-none',
                  !notification.read_at && 'bg-primary/[0.035]',
                  href ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                {!notification.read_at && (
                  <span className="absolute left-1.5 top-5 h-2 w-2 rounded-full bg-primary" />
                )}
                <span className="block pl-1.5 text-sm font-medium text-ink">
                  {notification.title}
                </span>
                <span className="mt-1 block pl-1.5 text-xs leading-5 text-ink-muted">
                  {notification.body}
                </span>
                <span className="mt-1.5 block pl-1.5 text-[11px] text-ink-muted/80">
                  {formatDistanceToNowStrict(new Date(notification.created_at), { addSuffix: true })}
                </span>
              </button>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InboxLoading() {
  return (
    <div className="space-y-1 p-3" aria-label="Loading notifications">
      {[0, 1, 2].map(item => (
        <div key={item} className="animate-pulse rounded-md px-2 py-3">
          <div className="h-3.5 w-2/3 rounded bg-border" />
          <div className="mt-2 h-3 w-full rounded bg-surface" />
          <div className="mt-1.5 h-3 w-4/5 rounded bg-surface" />
        </div>
      ))}
    </div>
  )
}

function InboxEmpty() {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-muted">
        <BellOff className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">No notifications yet</p>
      <p className="mt-1 max-w-60 text-xs leading-5 text-ink-muted">
        Stock, reservation, and order updates will appear here.
      </p>
    </div>
  )
}
