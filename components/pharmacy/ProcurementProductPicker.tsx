'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { procurementProductLabel, type ProcurementProduct } from '@/lib/procurement'

export function ProcurementProductPicker({ onSelect, disabled = false }: {
  onSelect: (product: ProcurementProduct) => void; disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<ProcurementProduct[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(''); setProducts([]); setMore(false)
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/pharmacy/procurement?view=products&q=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Search failed')
        setProducts(body.products); setMore(body.has_more)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Search failed')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, page, open])
  return <div className="mt-4 space-y-2">
    <label className="block text-sm font-medium">Find a medicine or Store item
      <Input type="search" aria-label="Search procurement items" placeholder="Search name, strength or barcode" value={query} disabled={disabled}
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setPage(0); setOpen(true) }} />
    </label>
    {open && <div className="rounded-lg border border-border bg-white p-3 text-ink">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs text-ink-muted">Select an item to add it</span><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close search</Button></div>
      <div className="max-h-72 space-y-1 overflow-y-auto" aria-live="polite">
        {loading ? <p className="p-3 text-sm">Searching…</p> : error ? <p role="alert" className="p-3 text-sm text-danger">{error}</p> : products.length === 0 ? <p className="p-3 text-sm">No matching items.</p> : products.map(product => {
          const expired = Boolean(product.deleted_at && (!product.recovery_expires_at || new Date(product.recovery_expires_at).getTime() <= Date.now()))
          return <button type="button" key={product.id} disabled={disabled || expired} className="block w-full rounded border border-border px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50" onClick={() => { onSelect(product); setOpen(false) }}>
            <span className="font-medium">[{product.target_type === 'medicine' ? 'Rx' : 'Store'}] {procurementProductLabel(product)}</span>
            {product.deleted_at && <span className="block text-xs text-amber-800">{expired ? 'Recovery window expired — contact the inventory administrator' : 'Removed — explicit restoration required when receiving'}</span>}
            {product.is_new && <span className="block text-xs text-ink-muted">New to your inventory — selling price needed when receiving</span>}
          </button>
        })}
      </div>
      <div className="mt-2 flex items-center justify-between"><Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous results</Button><span className="text-xs">Page {page + 1}</span><Button size="sm" variant="outline" disabled={!more || loading} onClick={() => setPage(value => value + 1)}>Next results</Button></div>
    </div>}
  </div>
}
