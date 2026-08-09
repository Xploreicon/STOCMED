'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider'
import {
  clearCachedSpToken,
  getCachedSpToken,
  isSpAuthorizationRequired,
  spAuthorizationRequiredError,
  withSpAuthorizationHeader,
} from '@/lib/sp-authorization-client'

type Reports = {
  range: { from: string; to: string }
  daily_sales: Array<{ sale_date: string; transaction_count: number; item_count: number; total_sales: number; medicine_sales: number; store_sales: number; medicine_items: number; store_items: number; cash: number | null; bank_transfer: number | null; terminal: number | null; other: number | null }>
  stock_valuation: Array<{ inventory_id: string; department: 'medicine' | 'store'; generic_name: string; brand_name: string | null; strength: string; quantity: number; unit_cost: number; retail_price: number; cost_value: number; retail_value: number }>
  margin_per_product: Array<{ inventory_id: string; department: 'medicine' | 'store'; generic_name: string; brand_name: string | null; strength: string; quantity_sold: number; revenue: number; cogs: number; margin: number }>
  dead_stock: Array<{ inventory_id: string; department: 'medicine' | 'store'; generic_name: string; brand_name: string | null; strength: string; quantity: number; last_sale_at: string | null; capital_tied_up: number }>
  expiry_exposure: Array<{ days: number; department: 'medicine' | 'store'; cost_value: number; retail_value: number; units: number }>
}

const iso = (date: Date) => date.toISOString().slice(0, 10)
const money = (value: number | null | undefined) => `₦${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const label = (item: { generic_name: string; brand_name: string | null; strength: string }) => `${item.brand_name || item.generic_name} ${item.strength}`
const total = <T,>(rows: T[], field: keyof T) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)

export default function ReportsPage() {
  const { isEnabled } = usePharmacyFeatures()
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))
  const [exportRequest, setExportRequest] = useState<{ format: 'csv' | 'xlsx'; dataset: string } | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [reportToken, setReportToken] = useState<string | null>(null)
  const query = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to])
  const { data: spSettings, isLoading: spSettingsLoading } = useQuery<{ configured: boolean; requireFinancialReports: boolean }>({
    queryKey: ['sp-authorization-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/sp-authorization')
      if (!response.ok) throw new Error('Could not load report controls')
      return response.json()
    },
  })
  const reportAuthorizationRequired = Boolean(spSettings?.configured && spSettings.requireFinancialReports)
  const { data, isLoading, error } = useQuery<{ reports: Reports }>({
    queryKey: ['pharmacy-reports', from, to, reportToken],
    queryFn: async () => {
      const response = await fetch(`/api/pharmacy/reports?${query}`, {
        headers: reportToken ? { 'x-sp-authorization': reportToken } : {},
      })
      const result = await response.json()
      if (response.status === 403 && (result.code === 'SP_AUTH_REQUIRED' || result.code === 'SP_REPORT_AUTH_REQUIRED')) {
        clearCachedSpToken('financial_reports')
        setReportToken(null)
        throw spAuthorizationRequiredError(result.error || 'Superintendent authorization is required.')
      }
      if (!response.ok) throw new Error(result.error || 'Could not load reports')
      return result
    },
    enabled: !spSettingsLoading && (!reportAuthorizationRequired || Boolean(reportToken)),
  })
  const reports = data?.reports

  if (spSettingsLoading || isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  if (reportAuthorizationRequired && !reportToken) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center"><h1 className="text-xl font-semibold text-ink">Financial reports are protected</h1><p className="mt-2 text-sm text-ink-muted">Ask the Superintendent Pharmacist to authorise access.</p></div>
        <SpAuthorizationModal
          open
          action="financial_reports"
          description="Authorise viewing the pharmacy's full financial reports"
          onAuthorized={(token) => {
            setReportToken(token)
            return false
          }}
          onClose={() => history.back()}
        />
      </div>
    )
  }
  if (error || !reports) return <div className="p-6 text-danger">{error instanceof Error ? error.message : 'Reports are unavailable'}</div>

  const exportHref = (format: 'csv' | 'xlsx', dataset = 'sales') => `/api/pharmacy/reports/export?${query}&format=${format}&dataset=${dataset}`
  const downloadExport = async (request: { format: 'csv' | 'xlsx'; dataset: string }, token: string | null) => {
    setIsExporting(true)
    try {
      const headers = withSpAuthorizationHeader('data_export', token)
      const currentReportToken = reportToken || getCachedSpToken('financial_reports')
      if (currentReportToken) headers.set('x-sp-report-authorization', currentReportToken)
      const response = await fetch(exportHref(request.format, request.dataset), {
        headers,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        if (response.status === 403 && payload?.code === 'SP_REPORT_AUTH_REQUIRED') {
          clearCachedSpToken('financial_reports')
          setReportToken(null)
          setExportRequest(null)
          return
        }
        if (response.status === 403 && payload?.code === 'SP_AUTH_REQUIRED') {
          clearCachedSpToken('data_export')
          setExportRequest(request)
          throw spAuthorizationRequiredError(payload?.error || 'Superintendent authorization is required.')
        }
        throw new Error(payload?.error || 'Could not export this report')
      }
      const payload = await response.blob()
      const url = URL.createObjectURL(payload)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `stocmed-${request.dataset}-${from}-to-${to}.${request.format}`
      anchor.click()
      URL.revokeObjectURL(url)
      setExportRequest(null)
    } finally {
      setIsExporting(false)
    }
  }
  const requestExport = async (request: { format: 'csv' | 'xlsx'; dataset: string }) => {
    try {
      await downloadExport(request, getCachedSpToken('data_export'))
    } catch (error) {
      if (!isSpAuthorizationRequired(error)) {
        alert(error instanceof Error ? error.message : 'Could not export this report')
      }
    }
  }
  const expiry90 = total(reports.expiry_exposure, 'cost_value')
  const departmentTotal = <T extends { department: 'medicine' | 'store' }>(rows: T[], field: keyof T, department: T['department']) =>
    total(rows.filter(row => row.department === department), field)

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Reports</h1><p className="mt-1 text-sm text-ink-muted">Sales, stock, margin, dead stock, and expiry. Nothing else.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-muted">From<Input className="mt-1" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="text-xs text-ink-muted">To<Input className="mt-1" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
          <Button asChild={false} variant="outline" disabled={isExporting} onClick={() => void requestExport({ format: 'csv', dataset: 'sales' })}><Download className="mr-2 h-4 w-4" />CSV</Button>
          {isEnabled('quickbooks_export') && <Button disabled={isExporting} onClick={() => void requestExport({ format: 'xlsx', dataset: 'sales' })}><FileSpreadsheet className="mr-2 h-4 w-4" />Accounting XLSX</Button>}
        </div>
      </header>

      <section className="border-y border-danger/30 bg-danger/5 px-4 py-5 sm:px-6">
        <p className="text-xs font-bold uppercase text-danger">Expiry exposure · next 90 days</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{money(expiry90)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Medicines {money(departmentTotal(reports.expiry_exposure, 'cost_value', 'medicine'))} · Store {money(departmentTotal(reports.expiry_exposure, 'cost_value', 'store'))}
        </p>
      </section>

      <Tabs defaultValue="daily">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="daily">Daily / Z</TabsTrigger><TabsTrigger value="valuation">Valuation</TabsTrigger><TabsTrigger value="margin">Margin</TabsTrigger><TabsTrigger value="dead">Dead stock</TabsTrigger><TabsTrigger value="expiry">Expiry</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-3">
          <div className="flex justify-end"><Link href="/pharmacy/shifts"><Button variant="outline"><Printer className="mr-2 h-4 w-4" />Printable shift Z-report</Button></Link></div>
          {reports.daily_sales.map(row => <article key={row.sale_date} className="border-b border-border py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{new Date(`${row.sale_date}T12:00:00`).toLocaleDateString()}</h3><strong className="text-lg">{money(row.total_sales)}</strong></div><div className="mt-2 grid grid-cols-2 gap-2 text-sm text-ink-muted sm:grid-cols-4"><span>{row.transaction_count} transactions</span><span>{row.item_count} items</span><span className="font-medium text-primary">Medicines {money(row.medicine_sales)}</span><span className="font-medium text-ink">Store {money(row.store_sales)}</span><span>Cash {money(row.cash)}</span><span>Transfer {money(row.bank_transfer)} · Terminal {money(row.terminal)}</span></div></article>)}
          {!reports.daily_sales.length && <p className="py-10 text-center text-ink-muted">No completed sales in this period.</p>}
        </TabsContent>

        <TabsContent value="valuation" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 border-b border-border py-4 sm:grid-cols-4"><div><p className="text-xs text-ink-muted">Combined cost</p><p className="text-xl font-semibold">{money(total(reports.stock_valuation, 'cost_value'))}</p></div><div><p className="text-xs text-ink-muted">Combined retail</p><p className="text-xl font-semibold">{money(total(reports.stock_valuation, 'retail_value'))}</p></div><div><p className="text-xs text-ink-muted">Medicine cost</p><p className="text-xl font-semibold text-primary">{money(departmentTotal(reports.stock_valuation, 'cost_value', 'medicine'))}</p></div><div><p className="text-xs text-ink-muted">Store cost</p><p className="text-xl font-semibold">{money(departmentTotal(reports.stock_valuation, 'cost_value', 'store'))}</p></div></div>
          {reports.stock_valuation.map(row => <ReportRow key={row.inventory_id} department={row.department} title={label(row)} detail={`${row.quantity} units · cost ${money(row.unit_cost)} · retail ${money(row.retail_price)}`} value={`${money(row.cost_value)} / ${money(row.retail_value)}`} />)}
        </TabsContent>

        <TabsContent value="margin" className="space-y-1">
          {reports.margin_per_product.map(row => <ReportRow key={row.inventory_id} department={row.department} title={label(row)} detail={`${row.quantity_sold} sold · revenue ${money(row.revenue)} · COGS ${money(row.cogs)}`} value={money(row.margin)} />)}
        </TabsContent>

        <TabsContent value="dead" className="space-y-1">
          {reports.dead_stock.map(row => <ReportRow key={row.inventory_id} department={row.department} title={label(row)} detail={`${row.quantity} units · ${row.last_sale_at ? `last sold ${new Date(row.last_sale_at).toLocaleDateString()}` : 'no recorded sale'}`} value={money(row.capital_tied_up)} />)}
          {!reports.dead_stock.length && <p className="py-10 text-center text-ink-muted">No stock has been idle for 90 days.</p>}
        </TabsContent>

        <TabsContent value="expiry" className="grid gap-3 sm:grid-cols-3">
          {reports.expiry_exposure.map(row => <article key={`${row.days}-${row.department}`} className="border border-border p-5 rounded-card"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-ink">{row.days - 29}–{row.days} days</p><DepartmentBadge department={row.department} /></div><p className="mt-2 text-2xl font-semibold text-danger">{money(row.cost_value)}</p><p className="mt-1 text-sm text-ink-muted">{row.units} units · {money(row.retail_value)} retail</p></article>)}
        </TabsContent>
      </Tabs>
      <SpAuthorizationModal
        open={exportRequest !== null}
        action="data_export"
        description={`Authorise export of pharmacy data from ${from} to ${to}`}
        onAuthorized={(token) => {
          const request = exportRequest
          return request ? downloadExport(request, token) : undefined
        }}
        onClose={() => setExportRequest(null)}
      />
    </div>
  )
}

function DepartmentBadge({ department }: { department: 'medicine' | 'store' }) {
  return <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${department === 'medicine' ? 'bg-primary/10 text-primary' : 'bg-ink/10 text-ink'}`}>{department}</span>
}

function ReportRow({ title, detail, value, department }: { title: string; detail: string; value: string; department: 'medicine' | 'store' }) {
  return <article className="flex min-w-0 flex-col gap-2 border-b border-border py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-ink">{title}</h3><DepartmentBadge department={department} /></div><p className="mt-1 text-sm text-ink-muted">{detail}</p></div><strong className="shrink-0 text-sm text-ink">{value}</strong></article>
}
