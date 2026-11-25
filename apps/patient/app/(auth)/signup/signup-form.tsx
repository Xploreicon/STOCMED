'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth/AuthShell'
import { PasswordField } from '@/components/auth/PasswordField'
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton'
import { createClient } from '@/lib/supabase/client'
import { clearAuthIntent, getAuthRedirectUrl, rememberAuthIntent } from '@/lib/auth/native-oauth'
import { useAuth } from '@/hooks/useAuth'

const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Other']

export default function SignupForm() {
  const router = useRouter()
  const { refreshProfile } = useAuth()
  const submitInFlight = useRef(false)
  const [isLoading, setIsLoading] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', location: '', password: '', confirmPassword: '' })

  const validate = () => {
    const next: Record<string, string> = {}
    if (!form.full_name.trim()) next.full_name = 'Full name is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Please enter a valid email address'
    if (!/^\+234\d{10}$/.test(form.phone.replace(/\s/g, ''))) next.phone = 'Phone must be in format +234XXXXXXXXXX'
    if (!LOCATIONS.includes(form.location)) next.location = 'Location is required'
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters'
    if (form.password !== form.confirmPassword) next.confirmPassword = 'Passwords do not match'
    if (!acceptedTerms) next.terms = 'You must confirm before continuing'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitInFlight.current || !validate()) return
    submitInFlight.current = true
    setIsLoading(true)
    try {
      const supabase = createClient()
      rememberAuthIntent('confirmation')
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(), password: form.password,
        options: {
          emailRedirectTo: getAuthRedirectUrl('confirmation'),
          data: { role: 'patient', full_name: form.full_name.trim(), phone: form.phone.replace(/\s/g, ''), location: form.location },
        },
      })
      if (error) throw error
      if (!data.user) throw new Error('Failed to create account. Please try again.')
      if (data.session) {
        clearAuthIntent()
        const { data: savedProfile, error: profileError } = await supabase.from('users')
          .select('user_id, role, location').eq('user_id', data.user.id).single()
        if (profileError || savedProfile?.role !== 'patient' || savedProfile.location !== form.location) {
          await supabase.auth.signOut()
          throw new Error('Your account profile and location could not be verified. Please sign in again or contact support.')
        }
        await refreshProfile()
        router.replace('/dashboard')
      } else {
        router.replace('/login?verifyEmail=1')
      }
    } catch (error) {
      try { clearAuthIntent() } catch {}
      setErrors({ general: error instanceof Error ? error.message : 'Account creation failed. Please try again.' })
    } finally {
      submitInFlight.current = false
      setIsLoading(false)
    }
  }

  const labelClass = 'block text-[14px] font-medium text-ink mb-2'
  const inputClass = 'w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60'
  const errorClass = (field: string) => errors[field] ? 'border-danger focus:border-danger focus:ring-danger/15' : ''

  return (
    <AuthShell title="Create your patient account" description="Find medication and reserve it at nearby pharmacies.">
      <GoogleOAuthButton onError={message => setErrors(message ? { general: message } : {})} />
      <div className="flex items-center gap-3 my-6" aria-hidden="true"><div className="flex-1 h-px bg-border" /><span className="text-[13px] text-ink-light">or use email</span><div className="flex-1 h-px bg-border" /></div>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {errors.general && <div role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger font-medium">{errors.general}</div>}
        <div>
          <label htmlFor="full_name" className={labelClass}>Full name</label>
          <input id="full_name" autoComplete="name" placeholder="Ada Nwosu" value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('full_name')}`} aria-invalid={Boolean(errors.full_name)} aria-describedby={errors.full_name ? 'signup-full_name-error' : undefined} />
          {errors.full_name && <p id="signup-full_name-error" className="text-xs text-danger mt-1.5">{errors.full_name}</p>}
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email address</label>
          <input id="email" type="email" autoComplete="email" placeholder="you@email.com" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('email')}`} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'signup-email-error' : undefined} />
          {errors.email && <p id="signup-email-error" className="text-xs text-danger mt-1.5">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone number</label>
          <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+234XXXXXXXXXX" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('phone')}`} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'signup-phone-error' : undefined} />
          {errors.phone && <p id="signup-phone-error" className="text-xs text-danger mt-1.5">{errors.phone}</p>}
        </div>
        <div>
          <label htmlFor="location" className={labelClass}>Location</label>
          <select id="location" value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('location')}`} aria-invalid={Boolean(errors.location)} aria-describedby={errors.location ? 'signup-location-error' : undefined}>
            <option value="">Select location</option>
            {LOCATIONS.map(location => <option key={location} value={location}>{location}</option>)}
          </select>
          <p className="text-[13px] text-ink-light mt-1.5">Used to show pharmacies nearest to you</p>
          {errors.location && <p id="signup-location-error" className="text-xs text-danger mt-1.5">{errors.location}</p>}
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <PasswordField id="password" autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('password')}`} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'signup-password-error' : undefined} />
          {errors.password && <p id="signup-password-error" className="text-xs text-danger mt-1.5">{errors.password}</p>}
        </div>
        <div>
          <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
          <PasswordField id="confirmPassword" autoComplete="new-password" placeholder="Re-enter your password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} disabled={isLoading} className={`${inputClass} ${errorClass('confirmPassword')}`} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'signup-confirmPassword-error' : undefined} />
          {errors.confirmPassword && <p id="signup-confirmPassword-error" className="text-xs text-danger mt-1.5">{errors.confirmPassword}</p>}
        </div>
        <label className="flex items-start gap-2.5 text-[14px] text-ink-muted cursor-pointer">
          <input type="checkbox" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} disabled={isLoading} className="mt-0.5 w-4 h-4 flex-shrink-0" style={{ accentColor: 'var(--primary)' }} aria-invalid={Boolean(errors.terms)} aria-describedby={errors.terms ? 'signup-terms-error' : undefined} />
          <span>I agree to StocMed&apos;s <Link href="/terms" className="text-primary underline hover:text-primary-hover font-medium">Terms of Service</Link> and consent to data processing under the <Link href="/privacy" className="text-primary underline hover:text-primary-hover font-medium">Privacy Policy</Link>.</span>
        </label>
        {errors.terms && <p id="signup-terms-error" role="alert" className="text-xs text-danger -mt-2">{errors.terms}</p>}
        <Button type="submit" disabled={isLoading} className="h-12 w-full bg-primary text-white text-[16px] font-medium rounded-button mt-2 hover:bg-[var(--primary-hover)] disabled:opacity-60">{isLoading ? 'Creating account…' : 'Create account'}</Button>
      </form>
      <p className="mt-7 text-center text-sm text-ink-muted">Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
    </AuthShell>
  )
}
