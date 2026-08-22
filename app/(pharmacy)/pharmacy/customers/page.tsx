'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  consent_whatsapp: boolean
  consent_sms: boolean
  consent_email: boolean
  notes: string | null
}

type Sale = {
  id: string
  total: number
  discount: number
  payment_method: string
  status: string
  created_at: string
}

const emptyForm = {
  name: '', phone: '', email: '', notes: '',
  consent_whatsapp: false, consent_sms: false, consent_email: false,
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = async (query = '') => {
    setLoading(true)
    const response = await fetch(`/api/pharmacy/customers?q=${encodeURIComponent(query)}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not load customers')
    else setCustomers(body.customers ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const openForm = (customer: Customer | 'new') => {
    setEditing(customer)
    setForm(customer === 'new' ? emptyForm : {
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      notes: customer.notes ?? '',
      consent_whatsapp: customer.consent_whatsapp,
      consent_sms: customer.consent_sms,
      consent_email: customer.consent_email,
    })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    const response = await fetch(
      editing === 'new' ? '/api/pharmacy/customers' : `/api/pharmacy/customers/${editing.id}`,
      {
        method: editing === 'new' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not save customer')
    else {
      toast.success(editing === 'new' ? 'Customer added' : 'Customer updated')
      setEditing(null)
      await load(search)
    }
    setSaving(false)
  }

  const showHistory = async (customer: Customer) => {
    setSelected(customer)
    setHistoryLoading(true)
    const response = await fetch(`/api/pharmacy/customers/${customer.id}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not load purchase history')
    else setSales(body.sales ?? [])
    setHistoryLoading(false)
  }

  const remove = async (customer: Customer) => {
    if (!window.confirm(`Remove ${customer.name}? Previous sales stay in reports.`)) return
    const response = await fetch(`/api/pharmacy/customers/${customer.id}`, { method: 'DELETE' })
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not remove customer')
    else {
      toast.success('Customer removed')
      if (selected?.id === customer.id) setSelected(null)
      await load(search)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Customers</h1>
          <p className="mt-2 text-sm text-ink-muted">Save only the details customers agree to share. Walk-in sales can stay anonymous.</p>
        </div>
        <Button onClick={() => openForm('new')}><Plus className="mr-2 h-4 w-4" />Add customer</Button>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="overflow-hidden rounded-card border border-border bg-card">
          <div className="border-b border-border p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, phone, or email" className="pl-9" />
            </label>
          </div>
          {loading ? (
            <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : customers.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
              <Users className="h-9 w-9 text-ink-light" />
              <p className="mt-3 font-medium text-ink">No customers found</p>
              <p className="mt-1 text-sm text-ink-muted">Add a customer here or attach one at checkout.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {customers.map(customer => (
                <article key={customer.id} className="flex min-h-20 items-center justify-between gap-3 p-4 hover:bg-surface">
                  <button type="button" onClick={() => void showHistory(customer)} className="min-w-0 flex-1 text-left">
                    <p className="truncate font-semibold text-ink">{customer.name}</p>
                    <p className="mt-1 truncate text-sm text-ink-muted">{customer.phone || customer.email || 'No contact saved'}</p>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${customer.name}`} onClick={() => openForm(customer)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${customer.name}`} onClick={() => void remove(customer)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-card border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-ink">Purchase history</h2>
          {!selected ? <p className="mt-3 text-sm text-ink-muted">Choose a customer to see their purchases.</p> : (
            <>
              <p className="mt-1 text-sm font-medium text-primary">{selected.name}</p>
              {historyLoading ? <Loader2 className="mt-6 h-6 w-6 animate-spin text-primary" /> : sales.length === 0 ? (
                <p className="mt-4 text-sm text-ink-muted">No attached sales yet.</p>
              ) : (
                <div className="mt-4 max-h-[520px] divide-y divide-border overflow-y-auto">
                  {sales.map(sale => (
                    <div key={sale.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div><p className="font-medium text-ink">{new Date(sale.created_at).toLocaleDateString()}</p><p className="text-xs capitalize text-ink-muted">{sale.payment_method.replaceAll('_', ' ')} · {sale.status}</p></div>
                      <p className="font-semibold tabular-nums text-ink">₦{Number(sale.total).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={save} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-feature bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-ink">{editing === 'new' ? 'Add customer' : 'Edit customer'}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Phone"><Input maxLength={32} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0803 123 4567" /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Notes"><Input maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <fieldset className="mt-5 rounded-card border border-border p-4">
              <legend className="px-1 text-sm font-semibold text-ink">Customer consent</legend>
              <p className="text-xs text-ink-muted">Tick only channels this customer agreed to use.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Consent id="customer-whatsapp" label="WhatsApp" checked={form.consent_whatsapp} onChange={checked => setForm({ ...form, consent_whatsapp: checked })} />
                <Consent id="customer-sms" label="SMS" checked={form.consent_sms} onChange={checked => setForm({ ...form, consent_sms: checked })} />
                <Consent id="customer-email" label="Email" checked={form.consent_email} onChange={checked => setForm({ ...form, consent_email: checked })} />
              </div>
            </fieldset>
            <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save customer'}</Button></div>
          </form>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>{children}</label>
}

function Consent(props: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-center gap-2"><Checkbox id={props.id} checked={props.checked} onCheckedChange={value => props.onChange(value === true)} /><Label htmlFor={props.id}>{props.label}</Label></div>
}
