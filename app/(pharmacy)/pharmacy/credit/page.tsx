'use client'

import { useEffect, useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { getCachedSpToken, withSpAuthorizationHeader } from '@/lib/sp-authorization-client'

type CustomerBalance = {
  customer_id: string
  name: string
  phone: string | null
  balance: number
  credit_limit: number
  available_credit: number
  last_activity: string | null
}

type Summary = {
  outstanding: number
  age_0_30: number
  age_31_60: number
  age_61_90: number
  age_90_plus: number
  credit_in_period: number
  payments_in_period: number
  write_offs_in_period: number
}

type Detail = {
  customer: { id: string; name: string; phone: string | null }
  credit_limit: number
  balance: number
  available_credit: number
  entries: Array<{ id: string; entry_type: string; amount: number; balance_after: number; notes: string | null; created_at: string }>
}

const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`

export default function CreditSalesPage() {
  const [customers, setCustomers] = useState<CustomerBalance[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [limit, setLimit] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState<null | { kind: 'limit' | 'write_off'; run: (token: string) => Promise<void> }>(null)

  const load = async () => {
    setLoading(true)
    const response = await fetch('/api/pharmacy/credit')
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not load credit balances')
    else {
      setCustomers(body.report?.customers ?? [])
      setSummary(body.report?.summary ?? null)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const openCustomer = async (customerId: string) => {
    const response = await fetch(`/api/pharmacy/credit?customer_id=${customerId}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) return toast.error(body?.error || 'Could not load customer balance')
    setDetail(body)
    setLimit(String(body.credit_limit))
    setAmount('')
    setNotes('')
  }

  const saveLimit = async (token = getCachedSpToken('credit_controls')) => {
    if (!detail) return
    const response = await fetch('/api/pharmacy/credit', {
      method: 'PUT',
      headers: withSpAuthorizationHeader('credit_controls', token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ customer_id: detail.customer.id, credit_limit: Number(limit) }),
    })
    const body = await response.json().catch(() => null)
    if (response.status === 403 && body?.code === 'SP_AUTH_REQUIRED') {
      setPending({ kind: 'limit', run: confirmed => saveLimit(confirmed) })
      return
    }
    if (!response.ok) {
      toast.error(body?.error || 'Could not save the credit limit')
      return
    }
    toast.success('Credit limit saved')
    setPending(null)
    await Promise.all([load(), openCustomer(detail.customer.id)])
  }

  const record = async (entryType: 'payment' | 'write_off', token: string | null = entryType === 'write_off' ? getCachedSpToken('credit_controls') : null) => {
    if (!detail) return
    const response = await fetch('/api/pharmacy/credit', {
      method: 'POST',
      headers: withSpAuthorizationHeader('credit_controls', token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ customer_id: detail.customer.id, entry_type: entryType, amount: Number(amount), notes }),
    })
    const body = await response.json().catch(() => null)
    if (response.status === 403 && body?.code === 'SP_AUTH_REQUIRED') {
      setPending({ kind: 'write_off', run: confirmed => record('write_off', confirmed) })
      return
    }
    if (!response.ok) {
      toast.error(body?.error || 'Could not record the balance update')
      return
    }
    toast.success(entryType === 'payment' ? 'Part payment recorded' : 'Balance written off')
    setAmount('')
    setNotes('')
    setPending(null)
    await Promise.all([load(), openCustomer(detail.customer.id)])
  }

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <header><h1 className="text-3xl font-semibold text-ink">Customer credit</h1><p className="mt-2 text-sm text-ink-muted">See what is owed, record part payments, and keep limits clear.</p></header>
      {summary && <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total outstanding" value={money(summary.outstanding)} />
        <Metric label="0–30 days" value={money(summary.age_0_30)} />
        <Metric label="31–90 days" value={money(summary.age_31_60 + summary.age_61_90)} />
        <Metric label="Over 90 days" value={money(summary.age_90_plus)} />
      </div>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="overflow-hidden rounded-card border border-border bg-card">
          <div className="border-b border-border p-4"><h2 className="font-semibold text-ink">Outstanding by customer</h2></div>
          {customers.length === 0 ? <p className="p-8 text-center text-sm text-ink-muted">No customer credit has been set up.</p> : <div className="divide-y divide-border">{customers.map(customer => (
            <button key={customer.customer_id} type="button" onClick={() => void openCustomer(customer.customer_id)} className="flex min-h-20 w-full items-center justify-between gap-4 p-4 text-left hover:bg-surface">
              <span className="min-w-0"><span className="block truncate font-semibold text-ink">{customer.name}</span><span className="mt-1 block text-xs text-ink-muted">Limit {money(customer.credit_limit)} · Available {money(customer.available_credit)}</span></span>
              <span className="shrink-0 text-right"><span className="block font-bold tabular-nums text-ink">{money(customer.balance)}</span><span className="text-xs text-ink-muted">owed</span></span>
            </button>
          ))}</div>}
        </section>

        <section className="rounded-card border border-border bg-card p-5">
          {!detail ? <div className="flex min-h-64 flex-col items-center justify-center text-center"><CreditCard className="h-9 w-9 text-ink-light" /><p className="mt-3 text-sm text-ink-muted">Choose a customer to manage their credit.</p></div> : <>
            <h2 className="text-lg font-semibold text-ink">{detail.customer.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">Owes {money(detail.balance)} · Available {money(detail.available_credit)}</p>
            <label className="mt-5 block"><span className="text-sm font-medium text-ink">Credit limit</span><div className="mt-2 flex gap-2"><Input type="number" min="0" value={limit} onChange={e => setLimit(e.target.value)} /><Button onClick={() => void saveLimit()}>Save</Button></div></label>
            <div className="mt-5 rounded-card border border-border p-4">
              <label className="block"><span className="text-sm font-medium text-ink">Amount</span><Input className="mt-2" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
              <label className="mt-3 block"><span className="text-sm font-medium text-ink">Note</span><Input className="mt-2" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional reference" /></label>
              <div className="mt-3 grid grid-cols-2 gap-2"><Button disabled={!Number(amount)} onClick={() => void record('payment')}>Record payment</Button><Button variant="outline" disabled={!Number(amount)} onClick={() => void record('write_off')}>Write off</Button></div>
            </div>
            <h3 className="mt-6 text-sm font-semibold text-ink">Ledger</h3>
            <div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto">{detail.entries.map(entry => <div key={entry.id} className="flex justify-between gap-3 py-3 text-sm"><span><span className="block capitalize text-ink">{entry.entry_type.replace('_', ' ')}</span><span className="text-xs text-ink-muted">{new Date(entry.created_at).toLocaleDateString()}</span></span><span className={Number(entry.amount) < 0 ? 'text-success' : 'text-ink'}>{Number(entry.amount) < 0 ? '-' : '+'}{money(Math.abs(Number(entry.amount)))}</span></div>)}</div>
          </>}
        </section>
      </div>
      <SpAuthorizationModal open={pending !== null} action="credit_controls" description={pending?.kind === 'limit' ? 'Change this customer credit limit' : 'Write off this customer balance'} onAuthorized={async token => { if (pending) await pending.run(token); return true }} onClose={() => setPending(null)} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card border border-border bg-card p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p></div>
}
