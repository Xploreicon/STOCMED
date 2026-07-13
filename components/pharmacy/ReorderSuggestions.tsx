'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, PackagePlus, TrendingUp } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Suggestion = {
  product_id: string
  generic_name: string
  brand_name: string | null
  strength: string
  current_stock: number
  daily_velocity: number
  days_to_stockout: number | null
  unmet_demand: number
  unit_margin: number
  suggested_quantity: number
  supplier_name: string | null
}

const money = (value: number) => `₦${Number(value || 0).toLocaleString()}`

export function ReorderSuggestions() {
  const [drafting, setDrafting] = useState<string | null>(null)
  const { data, isLoading, refetch } = useQuery<{ suggestions: Suggestion[] }>({
    queryKey: ['reorder-suggestions'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/reorder')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load reorder suggestions')
      return result
    },
  })

  const draft = async (productId: string) => {
    setDrafting(productId)
    try {
      const response = await fetch('/api/pharmacy/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not draft purchase order')
      toast.success('Draft purchase order created')
      await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not draft purchase order')
    } finally {
      setDrafting(null)
    }
  }

  if (isLoading) return <div data-testid="reorder-loading" className="mt-10 h-32 animate-pulse rounded-card bg-surface" />
  const suggestions = data?.suggestions ?? []
  if (!suggestions.length) return null

  return (
    <section className="mt-10 min-w-0 border-y border-border py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary"><TrendingUp className="h-4 w-4" /><span className="text-xs font-bold uppercase">Revenue opportunity</span></div>
          <h2 className="mt-1 text-xl font-semibold text-ink">Reorder suggestions</h2>
        </div>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary" href="/pharmacy/procurement">Purchase orders <ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
        {suggestions.slice(0, 4).map(item => (
          <article key={item.product_id} className="min-w-0 border border-border bg-white p-4 rounded-card">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-ink">{item.brand_name || item.generic_name} {item.strength}</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {item.days_to_stockout === null ? `${item.current_stock} units left` : item.days_to_stockout <= 0 ? 'Out of stock now' : `Runs out in about ${item.days_to_stockout} days`}
                </p>
                <p className="mt-1 text-xs text-ink-light">{item.unmet_demand} nearby searches this week · {money(item.unit_margin)} margin/unit</p>
              </div>
              <Button className="shrink-0" size="sm" disabled={drafting === item.product_id} onClick={() => draft(item.product_id)}>
                <PackagePlus className="mr-2 h-4 w-4" />Draft {item.suggested_quantity}
              </Button>
            </div>
            {!item.supplier_name && <p className="mt-2 text-xs text-warning">Receive once from a supplier to enable one-tap drafting.</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
