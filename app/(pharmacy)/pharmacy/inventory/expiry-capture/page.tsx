'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, ScanLine } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type QueueItem = {
  id: string
  source_name: string
  sku: string | null
  quantity: number
  unit_cost: number
  retail_price: number
  products: { generic_name: string; brand_name: string | null; strength: string; dosage_form: string | null } | null
}

export default function ExpiryCapturePage() {
  const [forms, setForms] = useState<Record<string, { batch_number: string; expiry_date: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const { data, isLoading, refetch } = useQuery<{ items: QueueItem[] }>({
    queryKey: ['quickbooks-expiry-capture'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/inventory/expiry-capture')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load expiry queue')
      return result
    },
  })
  const update = (id: string, patch: Partial<{ batch_number: string; expiry_date: string }>) =>
    setForms(current => ({
      ...current,
      [id]: {
        batch_number: patch.batch_number ?? current[id]?.batch_number ?? '',
        expiry_date: patch.expiry_date ?? current[id]?.expiry_date ?? '',
      },
    }))
  const capture = async (item: QueueItem) => {
    const form = forms[item.id]
    if (!form?.batch_number || !form.expiry_date) return toast.error('Enter the batch number and expiry date')
    setSaving(item.id)
    try {
      const response = await fetch('/api/pharmacy/inventory/expiry-capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staging_id: item.id, ...form }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not capture expiry')
      toast.success('Batch added to sellable inventory')
      await refetch()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not capture expiry') }
    finally { setSaving(null) }
  }

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  const items = data?.items ?? []
  return <div className="mx-auto w-full max-w-4xl space-y-6">
    <Link className="inline-flex items-center text-sm text-ink-muted" href="/pharmacy/inventory/import"><ArrowLeft className="mr-2 h-4 w-4" />Back to import</Link>
    <header><div className="flex items-center gap-2 text-primary"><ScanLine className="h-5 w-5" /><span className="text-xs font-bold uppercase">Physical shelf pass</span></div><h1 className="mt-2 text-2xl font-bold text-ink">Capture QuickBooks expiry gaps</h1><p className="mt-1 text-sm text-ink-muted">QuickBooks could not store this information. Read the batch and expiry directly from each carton; stock becomes sellable only after capture.</p></header>
    {!items.length ? <div className="border border-border py-14 text-center rounded-card"><Check className="mx-auto h-8 w-8 text-success" /><h2 className="mt-3 font-semibold">Expiry capture complete</h2><p className="mt-1 text-sm text-ink-muted">No staged QuickBooks items remain.</p></div> :
      <div className="space-y-3">{items.map(item => { const product = item.products; const form = forms[item.id] ?? { batch_number: '', expiry_date: '' }; return <article key={item.id} className="border-b border-border py-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end"><div className="min-w-0 flex-1"><h2 className="font-semibold text-ink">{product?.brand_name || product?.generic_name || item.source_name} {product?.strength}</h2><p className="mt-1 text-sm text-ink-muted">{item.quantity} units · QuickBooks cost ₦{Number(item.unit_cost).toLocaleString()} · retail ₦{Number(item.retail_price).toLocaleString()}</p></div><label className="text-xs text-ink-muted">Batch number<Input className="mt-1" value={form.batch_number} onChange={event => update(item.id, { batch_number: event.target.value })} /></label><label className="text-xs text-ink-muted">Expiry date<Input className="mt-1" type="date" value={form.expiry_date} onChange={event => update(item.id, { expiry_date: event.target.value })} /></label><Button disabled={saving === item.id} onClick={() => capture(item)}><Check className="mr-2 h-4 w-4" />Add stock</Button></div></article> })}</div>}
  </div>
}
