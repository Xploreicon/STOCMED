'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { requestPasswordRecovery, verifyRecoveryCode } from '@/lib/auth/recovery'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth/AuthShell'

export default function ForgotPassword() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sendCode() {
    if (busy) return
    const address = email.trim()
    if (!address) return
    setBusy('send')
    setError(null)
    setMessage(null)
    const result = await requestPasswordRecovery(address)
    setBusy(null)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setSentTo(address)
    setCode('')
    setMessage('If that email is registered, a reset code is on its way.')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!sentTo) {
      await sendCode()
      return
    }
    setBusy('verify')
    setError(null)
    setMessage(null)
    const result = await verifyRecoveryCode(sentTo, code)
    setBusy(null)
    if (result.error) setError(result.error.message)
    else router.replace('/update-password')
  }

  return (
    <AuthShell title="Reset password" description={sentTo
      ? 'Enter the one-time reset code from your email.'
      : 'Enter the email address linked to your account and we will send you a reset code.'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">Email address</label>
          <Input id="email" type="email" placeholder="you@example.com" value={email}
            onChange={event => setEmail(event.target.value)} required autoComplete="email"
            readOnly={Boolean(sentTo)} disabled={Boolean(busy)} className="h-12" />
        </div>
        {sentTo && <div className="space-y-2">
          <label htmlFor="reset-code" className="text-sm font-medium text-ink">Reset code</label>
          <Input id="reset-code" inputMode="numeric" autoComplete="one-time-code"
            value={code} onChange={event => setCode(event.target.value)} required disabled={Boolean(busy)}
            aria-invalid={Boolean(error)} aria-describedby={error ? 'reset-error' : undefined} className="h-12" />
        </div>}
        {message && <p role="status" className="text-sm text-success">{message}</p>}
        {error && <p id="reset-error" role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="h-12 w-full" disabled={Boolean(busy)}>
          {busy === 'send' ? 'Sending reset code…' : busy === 'verify' ? 'Verifying code…' : sentTo ? 'Verify code' : 'Send reset code'}
        </Button>
        {sentTo && <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={sendCode}>Send another code</Button>
          <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => {
            setSentTo('')
            setCode('')
            setError(null)
            setMessage(null)
          }}>Use a different email</Button>
        </div>}
      </form>
      <p className="mt-7 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
