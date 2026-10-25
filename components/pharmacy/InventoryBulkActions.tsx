'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { clearCachedSpToken, getCachedSpToken, withSpAuthorizationHeader } from '@/lib/sp-authorization-client'
import { withStaffSessionHeader } from '@/lib/staff-session-client'

type Item = { id: string; name?: string; brand_name?: string | null; generic_name?: string; deleted_at?: string | null; strength?: string; quantity_in_stock?: number }

export default function InventoryBulkActions({ items, selectedIds, onSelectAll, onClear }: {
  items: Item[]
  selectedIds: Set<string>
  onSelectAll: (selected: boolean) => void
  onClear: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('Duplicate item')
  const [error, setError] = useState('')
  const [needsAuthorization, setNeedsAuthorization] = useState(false)
  const selected = items.filter((item) => selectedIds.has(item.id))
  const restoring = selected.length > 0 && selected.every((item) => item.deleted_at)
  const mixed = selected.some((item) => Boolean(item.deleted_at) !== restoring)
  const action = restoring ? 'restore_inventory' : 'delist_inventory'
  const allSelected = items.length > 0 && selected.length === items.length

  async function submit(token: string | null) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/pharmacy/inventory/bulk', {
        method: 'POST',
        headers: withStaffSessionHeader({ ...withSpAuthorizationHeader(action, token), 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ids: selected.map((item) => item.id), action: restoring ? 'restore' : 'remove', reason }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 403 && result.code === 'SP_AUTH_REQUIRED') {
          clearCachedSpToken(action)
          setNeedsAuthorization(true)
          return
        }
        throw new Error(result.error || 'The selected items could not be changed')
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'] }),
        queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'] }),
      ])
      toast.success(restoring ? `${result.changed} items restored` : `${result.changed} items moved to the recovery bin for 60 days`)
      setOpen(false)
      onClear()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-4 py-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allSelected} onChange={(event) => onSelectAll(event.target.checked)}
          disabled={busy || items.length === 0} aria-label="Select all items on this page" className="h-4 w-4 accent-primary" />
        Select this page
      </label>
      <span className="text-sm text-ink-muted" role="status">{selected.length} selected</span>
      {selected.length > 0 && <>
        <Button variant="outline" size="sm" onClick={onClear} disabled={busy}>Clear selection</Button>
        <Button size="sm" variant={restoring ? 'default' : 'destructive'} disabled={busy || mixed}
          onClick={() => { setError(''); setOpen(true) }}>
          {restoring ? <RotateCcw className="mr-2 h-4 w-4" /> : <Trash2 className="mr-2 h-4 w-4" />}
          {restoring ? 'Restore selected' : 'Remove selected'}
        </Button>
      </>}
    </div>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{restoring ? 'Restore' : 'Remove'} {selected.length} selected items?</DialogTitle>
          <DialogDescription>
            {restoring ? 'These items will return to active inventory with their existing stock records.' :
              'These items will leave active inventory and patient search. You can restore them from the recovery bin for 60 days. Sales and stock history will be preserved.'}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 overflow-y-auto rounded border border-border px-4 py-2 text-sm">
          {selected.map((item) => <li key={item.id} className="border-b border-border py-2 last:border-0">
            <span className="font-medium">{item.name || item.brand_name || item.generic_name || 'Inventory item'}</span>
            <span className="block text-xs text-ink-muted">{[item.strength, item.quantity_in_stock !== undefined ? `${item.quantity_in_stock} in stock` : ''].filter(Boolean).join(' · ')}</span>
          </li>)}
        </ul>
        {!restoring && <label className="space-y-1 text-sm font-medium">
          <span>Reason for removal</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} className="h-10 w-full rounded border border-border bg-white px-3">
            <option>Duplicate item</option><option>Incorrect item or details</option><option>No longer stocked</option><option>Other inventory correction</option>
          </select>
        </label>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant={restoring ? 'default' : 'destructive'} onClick={() => void submit(getCachedSpToken(action))} disabled={busy || selected.length === 0 || mixed}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {restoring ? 'Restore selected items' : 'Move to recovery bin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SpAuthorizationModal open={needsAuthorization} action={action}
      description={`Authorise ${restoring ? 'restoring' : 'removing'} ${selected.length} selected inventory items`}
      onClose={() => setNeedsAuthorization(false)} onAuthorized={(token) => { setNeedsAuthorization(false); void submit(token) }} />
  </>
}
