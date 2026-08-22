'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Benchmark = {
  available: boolean
  code?: string
  message?: string
  peer_count?: number
  radius_km: number
  pharmacy_price?: number
  local_average?: number
  local_min?: number
  local_max?: number
  percentile?: number
}

const money = (value: number | undefined) => `₦${Number(value || 0).toLocaleString('en-NG',{ maximumFractionDigits: 2 })}`

export function PriceBenchmarkGuidance({ inventoryId }: { inventoryId: string }) {
  const [data,setData] = useState<Benchmark | null>(null)
  const [radius,setRadius] = useState('5')
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/pharmacy/price-benchmark?inventory_id=${inventoryId}`)
    const body = await response.json().catch(() => null)
    if (response.ok && body?.benchmark) {
      setData(body.benchmark)
      setRadius(String(body.benchmark.radius_km ?? 5))
    }
    setLoading(false)
  }, [inventoryId])
  useEffect(() => { void load() }, [load])

  const saveRadius = async () => {
    setSaving(true)
    const response = await fetch('/api/pharmacy/price-benchmark',{ method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ radius_km:Number(radius) }) })
    if (response.ok) await load()
    setSaving(false)
  }

  if (loading) return <div className="flex h-20 items-center justify-center rounded-lg bg-surface"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
  if (!data) return null
  return <section className="rounded-lg border border-primary/15 bg-primary/5 p-3">
    <div className="flex items-start gap-2"><BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-ink">Local price guidance</h4>{data.available ? <><p className="mt-1 text-xs text-ink-muted">Nearby average <strong className="text-ink">{money(data.local_average)}</strong> · range {money(data.local_min)}–{money(data.local_max)}</p><p className="mt-1 text-[11px] text-ink-light">Your price is around the {Math.round(data.percentile ?? 0)}th percentile across {data.peer_count} anonymous nearby pharmacies.</p></> : <p className="mt-1 text-xs leading-5 text-ink-muted">{data.message}</p>}</div></div>
    <div className="mt-3 flex items-end gap-2"><label className="flex-1 text-[11px] font-medium text-ink-muted">Comparison radius (km)<Input className="mt-1 h-9" type="number" min="1" max="50" step="0.5" value={radius} onChange={event => setRadius(event.target.value)} /></label><Button type="button" variant="outline" className="h-9" disabled={saving || Number(radius)<1 || Number(radius)>50} onClick={() => void saveRadius()}>{saving ? 'Saving…' : 'Update'}</Button></div>
  </section>
}
