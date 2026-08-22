'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, ShieldCheck, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { StaffSwitcher } from '@/components/pos/StaffSwitcher'
import { getCachedSpToken, withSpAuthorizationHeader } from '@/lib/sp-authorization-client'
import { withStaffSessionHeader, type StaffPermissions, type StaffSession } from '@/lib/staff-session-client'

type Staff = {
  id: string
  name: string
  role: 'owner' | 'pharmacist' | 'technician' | 'cashier'
  is_active: boolean
  permissions: StaffPermissions
  pin_locked_until: string | null
}

type ReportRow = { staff_id: string; name: string; role: string; sale_count: number; total_sales: number; average_sale: number; shifts_worked: number }

const emptyPermissions: StaffPermissions = { can_sell: true, can_adjust_stock: false, can_view_reports: false, can_change_prices: false, can_refund: false }
const permissionLabels: Array<[keyof StaffPermissions, string]> = [
  ['can_sell', 'Complete sales'], ['can_adjust_stock', 'Adjust stock'], ['can_view_reports', 'View reports'],
  ['can_change_prices', 'Change prices'], ['can_refund', 'Void or refund sales'],
]

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [session, setSession] = useState<StaffSession | null>(null)
  const [report, setReport] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Staff | 'new' | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<Staff['role']>('cashier')
  const [pin, setPin] = useState('')
  const [permissions, setPermissions] = useState<StaffPermissions>(emptyPermissions)
  const [saving, setSaving] = useState(false)
  const [pendingAction, setPendingAction] = useState<null | { description: string; run: (token: string) => Promise<void> }>(null)
  const [pinReset, setPinReset] = useState<Staff | null>(null)
  const [newPin, setNewPin] = useState('')

  const loadStaff = useCallback(async () => {
    const response = await fetch('/api/pharmacy/staff')
    const body = await response.json().catch(() => null)
    if (!response.ok) toast.error(body?.error || 'Could not load staff accounts')
    else setStaff(body.staff ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void loadStaff() }, [loadStaff])
  useEffect(() => {
    if (!session?.staff.permissions.can_view_reports) { setReport([]); return }
    void fetch('/api/pharmacy/staff/reports', { headers: withStaffSessionHeader({}, session.token) })
      .then(response => response.ok ? response.json() : null)
      .then(body => setReport(body?.report?.by_staff ?? []))
      .catch(() => undefined)
  }, [session])

  const openEditor = (member: Staff | 'new') => {
    setEditing(member)
    setName(member === 'new' ? '' : member.name)
    setRole(member === 'new' ? 'cashier' : member.role)
    setPin('')
    setPermissions(member === 'new' ? emptyPermissions : member.permissions)
  }

  const authorized = async (description: string, operation: (token: string | null) => Promise<Response>) => {
    const execute = async (token: string | null) => {
      const response = await operation(token)
      const body = await response.json().catch(() => null)
      if (response.status === 403 && body?.code === 'SP_AUTH_REQUIRED') {
        setPendingAction({ description, run: async confirmed => { await execute(confirmed) } })
        return
      }
      if (!response.ok) throw new Error(body?.error || 'Could not save this staff account')
      setPendingAction(null)
      setEditing(null)
      setPinReset(null)
      setNewPin('')
      toast.success(description)
      await loadStaff()
    }
    try { await execute(getCachedSpToken('staff_accounts')) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save this staff account') }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    const isNew = editing === 'new'
    await authorized(isNew ? 'Staff account created' : 'Staff account updated', token => fetch(isNew ? '/api/pharmacy/staff' : `/api/pharmacy/staff/${editing.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: withSpAuthorizationHeader('staff_accounts', token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, role, permissions, ...(isNew ? { pin } : {}) }),
    }))
    setSaving(false)
  }

  const setActive = (member: Staff) => authorized(member.is_active ? 'Staff account deactivated' : 'Staff account reactivated', token => fetch(`/api/pharmacy/staff/${member.id}`, {
    method: 'PATCH', headers: withSpAuthorizationHeader('staff_accounts', token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ operation: 'set_active', is_active: !member.is_active }),
  }))

  const resetPin = () => {
    if (!pinReset) return
    void authorized('Staff PIN reset', token => fetch(`/api/pharmacy/staff/${pinReset.id}`, {
      method: 'PATCH', headers: withSpAuthorizationHeader('staff_accounts', token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ operation: 'reset_pin', pin: newPin }),
    }))
  }

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  return <div className="mx-auto w-full max-w-6xl pb-12">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-semibold text-ink">Staff</h1><p className="mt-2 text-sm text-ink-muted">Give each person a private PIN and only the access they need.</p></div><Button onClick={() => openEditor('new')} className="gap-2"><Plus className="h-4 w-4" />Add staff member</Button></header>
    <section className="mt-6 rounded-card border border-border bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-ink">Current staff session</h2><p className="mt-1 text-xs text-ink-muted">Use the same staff PIN across POS, stock changes, refunds and reports.</p></div><div className="rounded-xl bg-slate-900 p-2"><StaffSwitcher value={session} onChange={setSession} /></div></div></section>
    <div className="mt-5 grid gap-4 md:grid-cols-2">{staff.map(member => <article key={member.id} className={`rounded-card border border-border bg-card p-5 ${member.is_active ? '' : 'opacity-60'}`}><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></div><div><h2 className="font-semibold text-ink">{member.name}</h2><p className="mt-1 text-xs capitalize text-ink-muted">{member.role} · {member.is_active ? 'Active' : 'Inactive'}</p>{member.pin_locked_until && new Date(member.pin_locked_until) > new Date() && <p className="mt-1 text-xs font-medium text-danger">PIN temporarily locked</p>}</div></div><Button variant="outline" onClick={() => openEditor(member)}>Edit</Button></div><div className="mt-4 flex flex-wrap gap-1.5">{permissionLabels.filter(([key]) => member.permissions[key]).map(([key, label]) => <span key={key} className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink-muted">{label}</span>)}</div><div className="mt-4 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => { setPinReset(member); setNewPin('') }}>Reset PIN</Button><Button variant="outline" className="flex-1" onClick={() => void setActive(member)}>{member.is_active ? 'Deactivate' : 'Reactivate'}</Button></div></article>)}</div>
    {!staff.length && <div className="mt-5 rounded-card border border-dashed border-border bg-card p-10 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-ink-light" /><p className="mt-3 text-sm text-ink-muted">Add your first staff member to start tracking sales by person.</p></div>}
    {report.length > 0 && <section className="mt-6 overflow-hidden rounded-card border border-border bg-card"><div className="border-b border-border p-4"><h2 className="font-semibold text-ink">Last 30 days by staff</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-surface text-left text-xs text-ink-muted"><tr><th className="p-3">Staff</th><th className="p-3">Sales</th><th className="p-3">Total</th><th className="p-3">Average</th><th className="p-3">Shifts</th></tr></thead><tbody className="divide-y divide-border">{report.map(row => <tr key={row.staff_id}><td className="p-3 font-medium text-ink">{row.name}</td><td className="p-3">{row.sale_count}</td><td className="p-3">₦{Number(row.total_sales).toLocaleString()}</td><td className="p-3">₦{Number(row.average_sale).toLocaleString()}</td><td className="p-3">{row.shifts_worked}</td></tr>)}</tbody></table></div></section>}

    {editing && <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5"><h2 className="text-xl font-semibold text-ink">{editing === 'new' ? 'Add staff member' : `Edit ${editing.name}`}</h2><label className="mt-4 block text-sm font-medium text-ink">Name<Input className="mt-2" value={name} onChange={event => setName(event.target.value)} required maxLength={160} /></label><label className="mt-4 block text-sm font-medium text-ink">Role<select value={role} onChange={event => setRole(event.target.value as Staff['role'])} className="mt-2 h-11 w-full rounded-button border border-border bg-white px-3"><option value="cashier">Cashier</option><option value="technician">Technician</option><option value="pharmacist">Pharmacist</option><option value="owner">Owner</option></select></label>{editing === 'new' && <label className="mt-4 block text-sm font-medium text-ink">Private PIN<Input className="mt-2" type="password" inputMode="numeric" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} minLength={4} maxLength={6} required /></label>}<fieldset className="mt-5"><legend className="text-sm font-semibold text-ink">Permissions</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{permissionLabels.map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={permissions[key]} onChange={event => setPermissions(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div></fieldset><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></div></form></div>}
    {pinReset && <div className="fixed inset-0 z-[66] flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-5"><h2 className="text-lg font-semibold text-ink">Reset {pinReset.name}&apos;s PIN</h2><Input className="mt-4" type="password" inputMode="numeric" value={newPin} onChange={event => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} placeholder="4 to 6 digits" /><div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setPinReset(null)}>Cancel</Button><Button disabled={newPin.length < 4} onClick={resetPin}>Reset PIN</Button></div></div></div>}
    <SpAuthorizationModal open={pendingAction !== null} action="staff_accounts" description={pendingAction?.description ?? 'Manage staff account'} onAuthorized={async token => { if (pendingAction) await pendingAction.run(token); return true }} onClose={() => setPendingAction(null)} />
  </div>
}
