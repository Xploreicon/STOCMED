'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildRecoveryRedirectUrl,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_EMAIL_STORAGE_KEY,
} from '@/lib/auth/password-recovery'

type RecoveryStage = 'code' | 'password'

export function PasswordRecoveryForm() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [stage, setStage] = useState<RecoveryStage>('code')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const savedEmail = window.sessionStorage.getItem(RECOVERY_EMAIL_STORAGE_KEY)
    if (savedEmail) setEmail(savedEmail)

    const params = new URLSearchParams(window.location.search)
    const arrivedFromRecoveryLink = params.get('verified') === '1'
    const callbackError = params.get('error')

    if (params.get('sent') === '1') {
      setMessage('If that email is registered, a password reset code has been sent.')
    }
    if (callbackError) {
      setError('That reset link is invalid or has expired. Request a new code below.')
    }

    let active = true
    const checkRecoverySession = async () => {
      if (!arrivedFromRecoveryLink) {
        if (active) setCheckingSession(false)
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (session) {
        setStage('password')
        setError(null)
      } else {
        setError('That reset link is invalid or has expired. Request a new code below.')
      }
      setCheckingSession(false)
    }

    void checkRecoverySession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStage('password')
        setError(null)
        setCheckingSession(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedCode = normalizeRecoveryCode(code)
    if (!normalizedEmail) {
      setError('Enter the email address linked to your account.')
      return
    }
    if (!isValidRecoveryCode(normalizedCode)) {
      setError('Enter the 6- to 8-digit reset code from your email.')
      return
    }

    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: 'recovery',
      })

      if (verifyError || !data.session) {
        setError('That reset code is invalid or has expired. Check the code or request a new one.')
        return
      }

      window.sessionStorage.setItem(RECOVERY_EMAIL_STORAGE_KEY, normalizedEmail)
      setStage('password')
      setMessage('Code verified. Choose your new password.')
    } catch (unknownError) {
      console.error('Unexpected recovery verification error:', unknownError)
      setError('We could not verify the code right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const resendCode = async () => {
    if (resending) return
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter your email address before requesting another code.')
      return
    }

    setResending(true)
    setError(null)
    setMessage(null)
    try {
      const { error: resendError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: buildRecoveryRedirectUrl(window.location.origin) },
      )
      if (resendError) {
        setError('We could not send another code right now. Please wait a moment and try again.')
        return
      }
      window.sessionStorage.setItem(RECOVERY_EMAIL_STORAGE_KEY, normalizedEmail)
      setMessage('If that email is registered, a new password reset code has been sent.')
    } catch (unknownError) {
      console.error('Unexpected recovery resend error:', unknownError)
      setError('We could not send another code right now. Please try again.')
    } finally {
      setResending(false)
    }
  }

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setStage('code')
        setError('Your recovery session has expired. Enter a new reset code to continue.')
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError('We could not update your password. Request a new code and try again.')
        return
      }

      window.sessionStorage.removeItem(RECOVERY_EMAIL_STORAGE_KEY)
      setMessage('Password updated. Redirecting you to sign in…')
      await supabase.auth.signOut({ scope: 'local' })
      router.replace('/login?password-reset=success')
      router.refresh()
    } catch (unknownError) {
      console.error('Unexpected password update error:', unknownError)
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Checking your recovery session…</p>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-panel p-12 text-primary-foreground lg:flex">
        <div className="pattern-dots absolute inset-0" />
        <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="relative">
          <Image src="/logo.png" alt="StocMed" width={160} height={53} className="h-10 w-auto brightness-0 invert" priority />
        </div>
        <div className="relative max-w-md space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur-sm">
            <KeyRound className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight">Secure account recovery.</h1>
          <p className="text-sm leading-relaxed opacity-80">
            Verify the time-limited code sent to your registered email, then choose a new password.
          </p>
          <div className="flex items-center gap-2 text-sm opacity-70">
            <ShieldCheck className="h-4 w-4" />
            NDPR-compliant data handling
          </div>
        </div>
        <div className="relative text-sm opacity-60">© {new Date().getFullYear()} StocMed. All rights reserved.</div>
      </div>

      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center gap-3 bg-brand-panel px-4 py-4 lg:hidden">
          <Image src="/logo.png" alt="StocMed" width={120} height={40} className="h-7 w-auto brightness-0 invert" priority />
          <span className="border-l border-white/20 pl-3 text-xs text-white/70">Secure Account Recovery</span>
        </div>

        <div className="flex flex-1 items-center justify-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">
                {stage === 'code' ? 'Enter your reset code' : 'Choose a new password'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {stage === 'code'
                  ? 'Use the code sent to the email address linked to your StocMed account.'
                  : 'Use at least 8 characters for your new password.'}
              </p>
            </div>

            {message && (
              <div role="status" className="rounded-md border border-success/20 bg-success/5 px-4 py-3 text-sm text-success shadow-sm">
                {message}
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-md border border-danger bg-danger/5 px-4 py-3 text-sm text-danger shadow-sm">
                {error}
              </div>
            )}

            {stage === 'code' ? (
              <form onSubmit={verifyCode} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="recovery-email" className="text-sm font-medium text-ink">Email address</label>
                  <Input
                    id="recovery-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    disabled={submitting || resending}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="recovery-code" className="text-sm font-medium text-ink">Reset code</label>
                  <Input
                    id="recovery-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(normalizeRecoveryCode(event.target.value).slice(0, 8))}
                    placeholder="Enter the code from your email"
                    required
                    disabled={submitting || resending}
                    className="h-11 tracking-[0.2em]"
                  />
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={submitting || resending}>
                  {submitting ? 'Verifying code…' : 'Verify code'}
                </Button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={submitting || resending}
                  className="w-full text-center text-sm font-semibold text-primary hover:underline disabled:opacity-60"
                >
                  {resending ? 'Sending another code…' : 'Send another code'}
                </button>
              </form>
            ) : (
              <form onSubmit={updatePassword} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium text-ink">New password</label>
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} disabled={submitting} className="h-11" />
                </div>
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-sm font-medium text-ink">Confirm password</label>
                  <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} disabled={submitting} className="h-11" />
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? 'Updating password…' : 'Update password'}
                </Button>
              </form>
            )}

            <div className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
