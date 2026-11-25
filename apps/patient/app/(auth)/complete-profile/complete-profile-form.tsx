'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/useAuth'

const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Other']

export default function CompleteProfileForm() {
  const router = useRouter()
  const { user, profile, loading, error: accountError, refreshProfile, signOut } = useAuth()
  const restrictedAccount = Boolean(profile?.role && profile.role !== 'patient')
  const [saving, setSaving] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    location: '',
  })

  useEffect(() => {
    if (loading || accountError) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (profile?.role === 'patient') {
      router.replace(profile.location?.trim() ? '/dashboard' : '/profile?required=location')
      return
    }
    const name = user.user_metadata?.full_name || user.user_metadata?.name
    setForm(current => current.full_name || typeof name !== 'string' ? current : { ...current, full_name: name })
  }, [loading, user, profile, accountError, router])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || restrictedAccount || accountError || !user) return
    setError('')
    if (!form.full_name.trim()) return setError('Enter your full name.')
    if (!/^\+234[789][01]\d{8}$/.test(form.phone)) {
      return setError('Enter a valid Nigerian mobile number in +234 format.')
    }
    if (!form.location) return setError('Choose your location.')
    if (!acceptedTerms) return setError('Confirm the terms and privacy notice before continuing.')

    setSaving(true)
    try {
      const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('complete_oauth_profile', {
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
      if (rpcError || data?.role !== 'patient') throw new Error(rpcError?.message || 'Your patient profile could not be completed.')
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) throw new Error('Your profile was saved. Sign in again to continue.')
      await refreshProfile()
      router.replace('/dashboard')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your profile could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'h-12 w-full rounded-button border border-border bg-white px-4 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15'

  if (loading || (!accountError && (!user || profile?.role === 'patient'))) return <div role="status" className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>

  if (accountError) return (
    <AuthShell title="Your account could not be checked" description="Retry the account check before completing your profile.">
      <p role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{accountError}</p>
      <Button className="mt-6 h-12 w-full" onClick={() => void refreshProfile()}>Retry account check</Button>
    </AuthShell>
  )

  if (restrictedAccount) return (
    <AuthShell title="Patient account required" description="Sign in with a patient account to continue.">
      <p role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">This app supports patient accounts. Sign in with a patient account.</p>
      <Button className="mt-6 h-12 w-full" onClick={async () => { await signOut(); router.replace('/login') }}>Return to sign in</Button>
    </AuthShell>
  )

  return (
    <AuthShell title="Finish your patient profile" description="Add your details to personalise medication search and find nearby pharmacies.">
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
              <span>I agree to the StocMed <Link href="/terms" className="text-primary underline">Terms of Service</Link> and <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>.</span>
            </label>
            {error && <p className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm font-medium text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={saving} className="h-12 w-full">{saving ? 'Saving…' : 'Continue as patient'}</Button>
          </form>

    </AuthShell>
  )
}
