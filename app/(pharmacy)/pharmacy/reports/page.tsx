'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Reports = {
  range: { from: string; to: string }
  daily_sales: Array<{ sale_date: string; transaction_count: number; item_count: number; total_sales: number; cash: number | null; bank_transfer: number | null; terminal: number | null; other: number | null }>
  stock_valuation: Array<{ inventory_id: string; generic_name: string; brand_name: string | null; strength: string; quantity: number; unit_cost: number; retail_price: number; cost_value: number; retail_value: number }>
  margin_per_product: Array<{ product_id: string; generic_name: string; brand_name: string | null; strength: string; quantity_sold: number; revenue: number; cogs: number; margin: number }>
  dead_stock: Array<{ inventory_id: string; generic_name: string; brand_name: string | null; strength: string; quantity: number; last_sale_at: string | null; capital_tied_up: number }>
  expiry_exposure: Array<{ days: number; cost_value: number; retail_value: number; units: number }>
}

const iso = (date: Date) => date.toISOString().slice(0, 10)
const money = (value: number | null | undefined) => `₦${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const label = (item: { generic_name: string; brand_name: string | null; strength: string }) => `${item.brand_name || item.generic_name} ${item.strength}`
const total = <T,>(rows: T[], field: keyof T) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)

export default function ReportsPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))
  const query = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to])
  const { data, isLoading, error } = useQuery<{ reports: Reports }>({
    queryKey: ['pharmacy-reports', from, to],
    queryFn: async () => {
      const response = await fetch(`/api/pharmacy/reports?${query}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load reports')
      return result
    },
  })
  const reports = data?.reports

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  if (error || !reports) return <div className="p-6 text-danger">{error instanceof Error ? error.message : 'Reports are unavailable'}</div>

  const exportHref = (format: 'csv' | 'xlsx', dataset = 'sales') => `/api/pharmacy/reports/export?${query}&format=${format}&dataset=${dataset}`
  const expiry90 = total(reports.expiry_exposure, 'cost_value')

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Reports</h1><p className="mt-1 text-sm text-ink-muted">Sales, stock, margin, dead stock, and expiry. Nothing else.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-muted">From<Input className="mt-1" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="text-xs text-ink-muted">To<Input className="mt-1" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
          <Button asChild={false} variant="outline" onClick={() => window.open(exportHref('csv'), '_blank')}><Download className="mr-2 h-4 w-4" />CSV</Button>
          <Button onClick={() => window.open(exportHref('xlsx'), '_blank')}><FileSpreadsheet className="mr-2 h-4 w-4" />QuickBooks XLSX</Button>
        </div>
      </header>

      <section className="border-y border-danger/30 bg-danger/5 px-4 py-5 sm:px-6">
        <p className="text-xs font-bold uppercase text-danger">Expiry exposure · next 90 days</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{money(expiry90)}</p>
        <p className="mt-1 text-sm text-ink-muted">Cost value currently at risk on the shelf.</p>
      </section>

      <Tabs defaultValue="daily">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="daily">Daily / Z</TabsTrigger><TabsTrigger value="valuation">Valuation</TabsTrigger><TabsTrigger value="margin">Margin</TabsTrigger><TabsTrigger value="dead">Dead stock</TabsTrigger><TabsTrigger value="expiry">Expiry</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-3">
          <div className="flex justify-end"><Link href="/pharmacy/shifts"><Button variant="outline"><Printer className="mr-2 h-4 w-4" />Printable shift Z-report</Button></Link></div>
          {reports.daily_sales.map(row => <article key={row.sale_date} className="border-b border-border py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{new Date(`${row.sale_date}T12:00:00`).toLocaleDateString()}</h3><strong className="text-lg">{money(row.total_sales)}</strong></div><div className="mt-2 grid grid-cols-2 gap-2 text-sm text-ink-muted sm:grid-cols-4"><span>{row.transaction_count} transactions</span><span>{row.item_count} items</span><span>Cash {money(row.cash)}</span><span>Transfer {money(row.bank_transfer)} · Terminal {money(row.terminal)}</span></div></article>)}
          {!reports.daily_sales.length && <p className="py-10 text-center text-ink-muted">No completed sales in this period.</p>}
        </TabsContent>

        <TabsContent value="valuation" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 border-b border-border py-4"><div><p className="text-xs text-ink-muted">At cost</p><p className="text-xl font-semibold">{money(total(reports.stock_valuation, 'cost_value'))}</p></div><div><p className="text-xs text-ink-muted">At retail</p><p className="text-xl font-semibold">{money(total(reports.stock_valuation, 'retail_value'))}</p></div></div>
          {reports.stock_valuation.map(row => <ReportRow key={row.inventory_id} title={label(row)} detail={`${row.quantity} units · cost ${money(row.unit_cost)} · retail ${money(row.retail_price)}`} value={`${money(row.cost_value)} / ${money(row.retail_value)}`} />)}
        </TabsContent>

        <TabsContent value="margin" className="space-y-1">
          {reports.margin_per_product.map(row => <ReportRow key={row.product_id} title={label(row)} detail={`${row.quantity_sold} sold · revenue ${money(row.revenue)} · COGS ${money(row.cogs)}`} value={money(row.margin)} />)}
        </TabsContent>

        <TabsContent value="dead" className="space-y-1">
          {reports.dead_stock.map(row => <ReportRow key={row.inventory_id} title={label(row)} detail={`${row.quantity} units · ${row.last_sale_at ? `last sold ${new Date(row.last_sale_at).toLocaleDateString()}` : 'no recorded sale'}`} value={money(row.capital_tied_up)} />)}
          {!reports.dead_stock.length && <p className="py-10 text-center text-ink-muted">No stock has been idle for 90 days.</p>}
        </TabsContent>

        <TabsContent value="expiry" className="grid gap-3 sm:grid-cols-3">
          {reports.expiry_exposure.map(row => <article key={row.days} className="border border-border p-5 rounded-card"><p className="text-sm font-medium text-ink">{row.days - 29}–{row.days} days</p><p className="mt-2 text-2xl font-semibold text-danger">{money(row.cost_value)}</p><p className="mt-1 text-sm text-ink-muted">{row.units} units · {money(row.retail_value)} retail</p></article>)}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ReportRow({ title, detail, value }: { title: string; detail: string; value: string }) {
  return <article className="flex min-w-0 flex-col gap-2 border-b border-border py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-ink">{title}</h3><p className="mt-1 text-sm text-ink-muted">{detail}</p></div><strong className="shrink-0 text-sm text-ink">{value}</strong></article>
}
