'use client'

import { useEffect, useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)))
}

async function persistSubscription(subscription: PushSubscription) {
  const response = await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error || 'Could not save the push subscription')
}

export function PushSubscriptionControl({
  onSubscriptionChange,
}: {
  onSubscriptionChange?: (enabled: boolean) => void
}) {
  const [supported, setSupported] = useState(true)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [syncError, setSyncError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setSupported(false)
        setLoading(false)
        return
      }
      try {
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()
        setSubscription(existing)
        if (existing) {
          try {
            await persistSubscription(existing)
            onSubscriptionChange?.(true)
          } catch (error) {
            setSyncError(error instanceof Error ? error.message : 'Could not sync this device')
          }
        } else {
          onSubscriptionChange?.(false)
        }
      } catch {
        setSupported(false)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [onSubscriptionChange])

  const enable = async () => {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Browser notification permission was not granted')
      const keyResponse = await fetch('/api/push/vapid-key')
      const keyResult = await keyResponse.json().catch(() => null)
      if (!keyResponse.ok || !keyResult?.publicKey) throw new Error(keyResult?.error || 'Push notifications are unavailable')
      const registration = await navigator.serviceWorker.ready
      const next = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyResult.publicKey),
      })
      try {
        await persistSubscription(next)
      } catch (error) {
        await next.unsubscribe().catch(() => false)
        throw error
      }
      setSubscription(next)
      setSyncError('')
      onSubscriptionChange?.(true)
      toast.success('Push notifications enabled on this device')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not enable push notifications')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!subscription) return
    setBusy(true)
    try {
      const response = await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error || 'Could not disable push notifications')
      await subscription.unsubscribe()
      setSubscription(null)
      setSyncError('')
      onSubscriptionChange?.(false)
      toast.success('Push notifications disabled on this device')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disable push notifications')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />
  if (!supported) {
    return <p className="text-sm text-ink-muted">Push notifications are not supported in this browser. Install StocMed as a PWA in a supported browser to enable them.</p>
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-semibold text-ink">Browser push notifications</p>
          <p className="text-sm text-ink-muted">
            {subscription ? 'Enabled on this device. You can disable it without changing email or SMS.' : 'Get time-sensitive StocMed updates on this installed device.'}
          </p>
          {syncError && <p className="mt-1 text-xs text-danger">{syncError}</p>}
        </div>
      </div>
      <Button type="button" variant={subscription ? 'outline' : 'default'} onClick={subscription ? disable : enable} disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {subscription ? 'Disable push' : 'Enable push'}
      </Button>
    </div>
  )
}
