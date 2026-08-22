'use client'

import { useEffect, useState } from 'react'
import { Search, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type PosCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  consent_whatsapp: boolean
}

export function CustomerPicker(props: {
  value: PosCustomer | null
  onChange: (customer: PosCustomer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PosCustomer[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/pharmacy/customers?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal })
        if (!response.ok) return
        const body = await response.json()
        setResults(body.customers ?? [])
      } catch { /* customer selection is optional */ }
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])

  if (props.value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-2">
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{props.value.name}</p><p className="truncate text-[10px] text-white/45">{props.value.phone || props.value.email || 'No contact'}</p></div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white/60 hover:text-white" onClick={() => props.onChange(null)} aria-label="Remove customer"><X className="h-3.5 w-3.5" /></Button>
      </div>
    )
  }

  return (
    <div className="relative">
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Optional customer" className="h-10 w-full rounded-lg border border-white/10 bg-[var(--pos-panel)] pl-9 pr-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-[var(--primary)]" />
      </label>
      {(query || results.length > 0) && (
        <div className="absolute bottom-11 left-0 right-0 z-20 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[var(--pos-panel)] p-1 shadow-2xl">
          {results.length === 0 ? <p className="p-3 text-center text-[11px] text-white/40">No customer found</p> : results.map(customer => (
            <button key={customer.id} type="button" onClick={() => { props.onChange(customer); setQuery('') }} className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-white/5">
              <UserRound className="h-4 w-4 shrink-0 text-[var(--pos-accent)]" />
              <span className="min-w-0"><span className="block truncate text-xs font-medium text-white">{customer.name}</span><span className="block truncate text-[10px] text-white/40">{customer.phone || customer.email || 'No contact'}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
