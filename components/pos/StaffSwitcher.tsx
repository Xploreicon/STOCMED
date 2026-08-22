'use client'

import { useEffect, useState } from 'react'
import { Loader2, LogOut, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  cacheStaffSession,
  clearStaffSession,
  getStaffSession,
  type StaffSession,
} from '@/lib/staff-session-client'

type Staff = {
  id: string
  name: string
  role: string
  is_active: boolean
}

export function StaffSwitcher({ value, onChange }: { value: StaffSession | null; onChange: (value: StaffSession | null) => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Staff | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const cached = getStaffSession()
    if (cached) {
      void fetch('/api/pharmacy/staff/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cached.token, permission: 'can_sell' }),
      }).then(async response => {
        if (response.ok) onChange(cached)
        else {
          clearStaffSession()
          onChange(null)
        }
      }).catch(() => onChange(cached))
    }
    void fetch('/api/pharmacy/staff').then(response => response.ok ? response.json() : null).then(body => {
      if (body?.staff) setStaff(body.staff.filter((item: Staff) => item.is_active))
    }).catch(() => undefined)
  }, [onChange])

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/pharmacy/staff/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: selected.id, pin }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.error || 'Could not switch staff member')
      const session = body as StaffSession
      cacheStaffSession(session)
      onChange(session)
      setOpen(false)
      setSelected(null)
      setPin('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not switch staff member')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  const signOut = () => {
    const session = value
    clearStaffSession()
    onChange(null)
    if (session) void fetch('/api/pharmacy/staff/session', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session.token }),
    }).catch(() => undefined)
  }

  return <>
    <div className="flex items-center gap-2">
      <Button type="button" onClick={() => setOpen(true)} className="h-9 gap-2 border border-white/15 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
        <UserRound className="h-4 w-4" />{value?.staff.name ?? 'Choose staff'}
      </Button>
      {value && <Button type="button" onClick={signOut} aria-label="End staff session" className="h-9 w-9 border border-white/10 bg-white/5 p-0 text-white/60 hover:bg-white/10"><LogOut className="h-4 w-4" /></Button>}
    </div>
    {open && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[var(--pos-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-white">Who is selling?</h2><p className="mt-1 text-xs text-white/45">Choose your name and enter your PIN.</p></div><button type="button" onClick={() => setOpen(false)} className="p-2 text-white/50"><X className="h-5 w-5" /></button></div>
        {!selected ? <div className="mt-4 grid gap-2">{staff.length ? staff.map(item => <button type="button" key={item.id} onClick={() => { setSelected(item); setError('') }} className="min-h-14 rounded-xl border border-white/10 bg-white/5 px-4 text-left text-sm text-white hover:border-primary"><span className="block font-semibold">{item.name}</span><span className="mt-0.5 block text-[11px] capitalize text-white/40">{item.role}</span></button>) : <p className="rounded-xl bg-white/5 p-4 text-center text-xs text-white/50">No active staff accounts. Add one from Staff.</p>}</div> : <form onSubmit={signIn} className="mt-5">
          <button type="button" onClick={() => { setSelected(null); setPin(''); setError('') }} className="text-xs text-primary">← Choose another person</button>
          <p className="mt-4 text-sm font-semibold text-white">{selected.name}</p>
          <input autoFocus type="password" inputMode="numeric" autoComplete="one-time-code" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} className="mt-3 h-16 w-full rounded-xl border border-white/15 bg-black/20 text-center text-3xl tracking-[0.4em] text-white outline-none focus:border-primary" aria-label="Staff PIN" />
          {error && <p className="mt-2 text-xs font-medium text-red-300" role="alert">{error}</p>}
          <Button type="submit" disabled={loading || pin.length < 4} className="mt-4 h-11 w-full">{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start selling</Button>
        </form>}
      </div>
    </div>}
  </>
}
