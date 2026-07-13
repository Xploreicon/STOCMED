'use client'

import { Button } from '@/components/ui/button'

import React from 'react'
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'

interface SyncPillProps {
  isOnline: boolean
  syncStatus: 'synced' | 'pending' | 'syncing' | 'error'
  pendingCount: number
  onRetry: () => void
}

export default function SyncPill({ isOnline, syncStatus, pendingCount, onRetry }: SyncPillProps) {
  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs">
        <WifiOff className="h-3.5 w-3.5 text-white/40" />
        <span className="text-white/50 font-medium">Offline — sales saved</span>
      </div>
    )
  }

  if (syncStatus === 'synced') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--pos-success)]/10 border border-[var(--pos-success)]/20 text-xs">
        <Wifi className="h-3.5 w-3.5 text-[var(--pos-success)]" />
        <span className="text-[var(--pos-success)] font-semibold">Synced</span>
      </div>
    )
  }

  if (syncStatus === 'syncing') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--pos-accent)]/10 border border-[var(--pos-accent)]/20 text-xs animate-pulse">
        <RefreshCw className="h-3.5 w-3.5 text-[var(--pos-accent)] animate-spin" />
        <span className="text-[var(--pos-accent)] font-semibold">Syncing...</span>
      </div>
    )
  }

  if (syncStatus === 'error') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--pos-danger)]/10 border border-[var(--pos-danger)]/20 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--pos-danger)]" />
        <span className="text-[var(--pos-danger)] font-semibold">{pendingCount} failed</span>
        <Button onClick={onRetry} className="ml-1 text-[10px] underline text-[var(--pos-danger)] hover:text-white transition">
          Retry
        </Button>
      </div>
    )
  }

  // pending
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--pos-warning)]/10 border border-[var(--pos-warning)]/20 text-xs">
      <Wifi className="h-3.5 w-3.5 text-[var(--pos-warning)]" />
      <span className="text-[var(--pos-warning)] font-semibold">{pendingCount} sale{pendingCount !== 1 ? 's' : ''} queued</span>
    </div>
  )
}
