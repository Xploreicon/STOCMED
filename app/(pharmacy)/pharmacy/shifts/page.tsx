'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, ChevronDown, ChevronUp, History, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { posLocalDb, type LocalSale, type LocalShift } from '@/lib/db/pos-local-db'
import { syncPendingSales } from '@/lib/pos/sync-engine'
import { calculateShiftSales, reconcileCash } from '@/lib/pos/shifts'

type Context = { pharmacy_id: string; cashier_id: string; cashier_name: string }
type ShiftReport = {
  shift: LocalShift
  cashier: string
  transaction_count: number
  item_count: number
  total_sales: number
  cash_sales: number
  bank_transfer_sales: number
  terminal_sales: number
  other_sales: number
}

const denominations = [1000, 500, 200, 100, 50, 20, 10, 5]
const money = (value: number) => `₦${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function localReport(shift: LocalShift, sales: LocalSale[], cashier: string): ShiftReport {
  const totals = calculateShiftSales(sales, shift.id)
  return {
    shift, cashier,
    transaction_count: totals.transactionCount, item_count: totals.itemCount,
    total_sales: totals.totalSales, cash_sales: totals.cashSales,
    bank_transfer_sales: totals.bankTransferSales, terminal_sales: totals.terminalSales,
    other_sales: totals.otherSales,
  }
}

export default function ShiftsPage() {
  const [context, setContext] = useState<Context | null>(null)
  const [shifts, setShifts] = useState<LocalShift[]>([])
  const [sales, setSales] = useState<LocalSale[]>([])
  const [serverReports, setServerReports] = useState<ShiftReport[]>([])
  const [openingFloat, setOpeningFloat] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [notes, setNotes] = useState('')
  const [showDenominations, setShowDenominations] = useState(false)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ShiftReport | null>(null)

  const loadLocal = useCallback(async () => {
    if (!posLocalDb) return
    const [localShifts, localSales] = await Promise.all([
      posLocalDb.local_shifts.orderBy('opened_at').reverse().toArray(),
      posLocalDb.local_sales.toArray(),
    ])
    setShifts(localShifts)
    setSales(localSales)
  }, [])

  const load = useCallback(async () => {
    await loadLocal()
    const saved = localStorage.getItem('stocmed-pos-context')
    if (saved) setContext(JSON.parse(saved) as Context)
    if (!navigator.onLine) return
    try {
      await syncPendingSales()
      const response = await fetch('/api/pharmacy/shifts')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load shifts')
      setContext(data.context)
      localStorage.setItem('stocmed-pos-context', JSON.stringify(data.context))
      setServerReports(data.reports ?? [])
      if (posLocalDb) {
        await posLocalDb.local_shifts.bulkPut((data.shifts ?? []).map((shift: LocalShift) => ({
          ...shift, opening_float: Number(shift.opening_float), counted_cash: shift.counted_cash == null ? undefined : Number(shift.counted_cash),
          expected_cash: shift.expected_cash == null ? undefined : Number(shift.expected_cash),
          variance: shift.variance == null ? undefined : Number(shift.variance), sync_status: 'synced', retry_count: 0,
        })))
      }
      await loadLocal()
    } catch (error) {
      if (!saved) toast.error(error instanceof Error ? error.message : 'Could not load shifts')
    }
  }, [loadLocal])

  useEffect(() => { load() }, [load])

  const currentShift = shifts.find((shift) => shift.status === 'open') ?? null
  const currentReport = currentShift && context ? localReport(currentShift, sales, context.cashier_name) : null
  const expectedCash = currentReport ? reconcileCash(currentReport.shift.opening_float, currentReport.cash_sales, 0).expectedCash : 0
  const counted = Number(countedCash || 0)
  const variance = counted - expectedCash
  const denominationTotal = denominations.reduce((sum, denomination) => sum + denomination * (counts[denomination] || 0), 0)

  const openShift = async () => {
    if (!context || Number(openingFloat) < 0 || openingFloat === '') return
    setBusy(true)
    const shift: LocalShift = {
      id: crypto.randomUUID(), pharmacy_id: context.pharmacy_id, cashier_id: context.cashier_id,
      opened_at: new Date().toISOString(), opening_float: Number(openingFloat), status: 'open',
      sync_status: 'pending', retry_count: 0,
    }
    await posLocalDb?.local_shifts.add(shift)
    setOpeningFloat('')
    await loadLocal()
    if (navigator.onLine) await syncPendingSales()
    setBusy(false)
    toast.success('Shift opened')
  }

  const closeShift = async () => {
    if (!currentShift || countedCash === '' || counted < 0) return
    setBusy(true)
    await posLocalDb?.local_shifts.update(currentShift.id, {
      status: 'closed', closed_at: new Date().toISOString(), counted_cash: counted,
      expected_cash: expectedCash, variance, notes: notes.trim() || undefined,
      sync_status: 'pending', retry_count: 0, next_retry_at: undefined,
    })
    setSelectedReport(localReport({ ...currentShift, status: 'closed', counted_cash: counted, expected_cash: expectedCash, variance }, sales, context?.cashier_name || 'Cashier'))
    setCountedCash(''); setNotes(''); setCounts({}); setShowDenominations(false)
    await loadLocal()
    if (navigator.onLine) await syncPendingSales()
    setBusy(false)
    toast.success('Shift closed')
  }

  const reports = useMemo(() => {
    const byId = new Map(serverReports.map((report) => [report.shift.id, report]))
    if (context) shifts.forEach((shift) => {
      if (!byId.has(shift.id)) byId.set(shift.id, localReport(shift, sales, context.cashier_name))
    })
    return [...byId.values()].sort((a, b) => b.shift.opened_at.localeCompare(a.shift.opened_at))
  }, [context, sales, serverReports, shifts])

  const runningVariance = new Map<string, number>()

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Shifts & cash</h1><p className="text-sm text-ink-muted">Open once. Close once. Cash sales only.</p></div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Sync</Button>
      </header>

      {!currentShift ? (
        <Card className="max-w-lg p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><Banknote className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Open shift</h2><p className="text-sm text-ink-muted">Enter the cash already in the drawer.</p></div></div>
          <label className="mb-2 block text-sm font-medium" htmlFor="opening-float">Opening float</label>
          <Input id="opening-float" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} />
          <Button className="mt-4 w-full sm:w-auto" onClick={openShift} disabled={busy || !context || openingFloat === ''}>Open shift</Button>
        </Card>
      ) : (
        <Card className="p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section>
              <p className="text-xs font-semibold uppercase text-ink-muted">Expected cash</p>
              <p className="mt-1 text-3xl font-bold text-ink">{money(expectedCash)}</p>
              <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex justify-between"><span className="text-ink-muted">Opening float</span><span>{money(currentShift.opening_float)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Cash sales</span><span>{money(currentReport?.cash_sales || 0)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Transfer + terminal</span><span>{money((currentReport?.bank_transfer_sales || 0) + (currentReport?.terminal_sales || 0))}</span></div>
              </div>
            </section>
            <section>
              <label className="mb-2 block text-sm font-medium" htmlFor="counted-cash">Counted cash</label>
              <Input id="counted-cash" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} />
              {countedCash !== '' && <p className={`mt-3 text-lg font-bold ${variance === 0 ? 'text-success' : variance < 0 ? 'text-destructive' : 'text-warning'}`}>{variance === 0 ? 'Balanced ✓' : `${money(Math.abs(variance))} ${variance < 0 ? 'SHORT' : 'OVER'}`}</p>}
              <Button variant="ghost" className="mt-3 px-0" onClick={() => setShowDenominations((value) => !value)}>{showDenominations ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}Count by denomination</Button>
              {showDenominations && <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">{denominations.map((denomination) => <label key={denomination} className="text-xs text-ink-muted">₦{denomination}<Input className="mt-1" type="number" min="0" inputMode="numeric" value={counts[denomination] || ''} onChange={(event) => { const next = { ...counts, [denomination]: Number(event.target.value) }; setCounts(next); setCountedCash(String(denominations.reduce((sum, note) => sum + note * (next[note] || 0), 0))) }} /></label>)}<p className="col-span-full text-right text-sm font-semibold">Total {money(denominationTotal)}</p></div>}
              <Textarea className="mt-3" placeholder="Optional note" value={notes} onChange={(event) => setNotes(event.target.value)} />
              <Button className="mt-4 w-full sm:w-auto" onClick={closeShift} disabled={busy || countedCash === ''}>Close shift</Button>
            </section>
          </div>
        </Card>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">Shift history</h2></div>
        <div className="space-y-2">{reports.map((report) => {
          const running = (runningVariance.get(report.cashier) || 0) + Number(report.shift.variance || 0)
          runningVariance.set(report.cashier, running)
          return <div key={report.shift.id} className="grid gap-3 border-b border-border py-4 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center"><div><p className="font-medium">{report.cashier}</p><p className="text-xs text-ink-muted">{new Date(report.shift.opened_at).toLocaleString()}</p></div><div className="text-sm"><p>{report.transaction_count} transactions · {report.item_count} items</p><p className="text-ink-muted">Sales {money(report.total_sales)}</p></div><div className="text-sm"><p>Variance {money(Number(report.shift.variance || 0))}</p><p className="text-ink-muted">Running {money(running)}</p></div><Button size="sm" variant="outline" onClick={() => setSelectedReport(report)}><Printer className="mr-2 h-4 w-4" />Z-report</Button></div>
        })}{!reports.length && <p className="py-8 text-sm text-ink-muted">No shifts yet.</p>}</div>
      </section>

      {selectedReport && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-3 print:static print:block print:bg-white print:p-0"><div className="max-h-[90vh] w-full max-w-sm overflow-y-auto bg-white p-6 text-ink shadow-card print:max-h-none print:shadow-none"><div className="text-center"><p className="font-bold">StocMed Z-REPORT</p><p className="text-xs text-ink-muted">{new Date(selectedReport.shift.opened_at).toLocaleString()}</p></div><div className="my-5 space-y-2 border-y border-dashed border-border py-4 text-sm"><div className="flex justify-between"><span>Transactions</span><span>{selectedReport.transaction_count}</span></div><div className="flex justify-between"><span>Items</span><span>{selectedReport.item_count}</span></div><div className="flex justify-between"><span>Cash</span><span>{money(selectedReport.cash_sales)}</span></div><div className="flex justify-between"><span>Transfer</span><span>{money(selectedReport.bank_transfer_sales)}</span></div><div className="flex justify-between"><span>Terminal</span><span>{money(selectedReport.terminal_sales)}</span></div><div className="flex justify-between"><span>Other</span><span>{money(selectedReport.other_sales)}</span></div><div className="flex justify-between font-bold"><span>Total</span><span>{money(selectedReport.total_sales)}</span></div></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Expected</span><span>{money(Number(selectedReport.shift.expected_cash || selectedReport.shift.opening_float + selectedReport.cash_sales))}</span></div><div className="flex justify-between"><span>Counted</span><span>{selectedReport.shift.counted_cash == null ? 'Open' : money(Number(selectedReport.shift.counted_cash))}</span></div><div className="flex justify-between font-bold"><span>Variance</span><span>{money(Number(selectedReport.shift.variance || 0))}</span></div></div><div className="mt-6 flex gap-2 print:hidden"><Button className="flex-1" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button><Button variant="outline" onClick={() => setSelectedReport(null)}>Close</Button></div></div></div>}
    </div>
  )
}
