'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Other']

export default function CompleteProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    location: '',
  })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }

      const { data: profile } = await (supabase.from('users') as any)
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (profile?.role === 'patient' || profile?.role === 'pharmacy') {
        router.replace(profile.role === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard')
        return
      }

      setForm(current => ({
        ...current,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      }))
      setLoading(false)
    }
    void load()
  }, [router])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.full_name.trim()) return setError('Enter your full name.')
    if (!/^\+234[789][01]\d{8}$/.test(form.phone)) {
      return setError('Enter a valid Nigerian mobile number in +234 format.')
    }
    if (!form.location) return setError('Choose your location.')
    if (!acceptedTerms) return setError('Confirm the terms and privacy notice before continuing.')

    setSaving(true)
    const supabase = createClient()
    const { data, error: rpcError } = await (supabase.rpc as any)('complete_oauth_profile', {
      p_role: 'patient',
      p_full_name: form.full_name.trim(),
      p_phone: form.phone,
      p_location: form.location,
      p_pharmacy_name: null,
      p_license_number: null,
      p_address: null,
      p_city: null,
      p_state: null,
    })

    if (rpcError || data?.role !== 'patient') {
      setError(rpcError?.message || 'Your patient profile could not be completed.')
      setSaving(false)
      return
    }
    await supabase.auth.refreshSession()
    router.replace('/dashboard')
    router.refresh()
  }

  const inputClass = 'h-12 w-full rounded-button border border-border bg-white px-4 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15'

  if (loading) return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>

  return (
    <div className="min-h-screen bg-page-wash px-6 py-8 text-ink">
      <div className="mx-auto max-w-[560px]">
        <Logo size={32} wordSize={18} href="/" />
        <div className="mt-10 rounded-card-lg border border-border bg-white p-7 shadow-lg sm:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-[30px] font-medium">Finish your patient profile</h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-muted">
            New Google accounts are patient accounts. Pharmacy registration requires email and password so we can collect PCN and pharmacy details.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-5">
            <label className="block text-sm font-medium">Full name
              <input className={`${inputClass} mt-2`} value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} />
            </label>
            <label className="block text-sm font-medium">Mobile number
              <input className={`${inputClass} mt-2`} inputMode="tel" placeholder="+2348031234567" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value.replace(/\s/g, '') })} />
            </label>
            <label className="block text-sm font-medium">Location
              <select className={`${inputClass} mt-2`} value={form.location} onChange={event => setForm({ ...form, location: event.target.value })}>
                <option value="">Choose location</option>
                {LOCATIONS.map(location => <option key={location}>{location}</option>)}
              </select>
            </label>

            <label className="flex items-start gap-3 text-sm text-ink-muted">
              <input type="checkbox" className="mt-1" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} />
              <span>I agree to the StocMed terms and privacy notice.</span>
            </label>
            {error && <p className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm font-medium text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={saving} className="h-12 w-full">{saving ? 'Saving…' : 'Continue as patient'}</Button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Registering a pharmacy?{' '}
            <Link href="/signup?role=pharmacy" className="font-medium text-primary hover:underline">Use email and password</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
