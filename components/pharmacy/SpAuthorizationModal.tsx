'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SpAction } from '@/lib/sp-authorization'
import { cacheSpToken } from '@/lib/sp-authorization-client'

type AuthorizationResult = void | boolean | Promise<void | boolean>

type Props = {
  open: boolean
  description: string
  onClose: () => void
} & (
  | {
      mode?: 'token'
      action: SpAction
      onAuthorized: (token: string) => AuthorizationResult
    }
  | {
      mode: 'current-code'
      action?: never
      onAuthorized: (currentCode: string) => AuthorizationResult
    }
)

export function SpAuthorizationModal(props: Props) {
  const { open, description, onClose } = props
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setError('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter all 6 digits.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      if (props.mode === 'current-code') {
        const shouldClose = await props.onAuthorized(code)
        if (shouldClose === false) return
      } else {
        const response = await fetch('/api/pharmacy/sp-authorization', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, action: props.action, target: description }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Authorization failed.')
        cacheSpToken(props.action, body.token)
        const shouldClose = await props.onAuthorized(body.token)
        if (shouldClose === false) return
      }
      setCode('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed.')
      setCode('')
      inputRef.current?.focus()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="sp-auth-title">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-muted hover:bg-surface" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 id="sp-auth-title" className="mt-4 text-xl font-semibold text-ink">
          {props.mode === 'current-code' ? 'Confirm superintendent code' : 'SP authorization'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="mt-5 h-16 w-full rounded-button border border-border bg-surface text-center text-3xl font-semibold tracking-[0.45em] text-ink outline-none focus:border-primary"
          aria-label="Six digit superintendent code"
        />
        {error && <p className="mt-2 text-sm font-medium text-danger" role="alert">{error}</p>}
        <Button type="submit" disabled={isSubmitting || code.length !== 6} className="mt-5 h-12 w-full gap-2">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {props.mode === 'current-code' ? 'Confirm' : 'Authorize'}
        </Button>
      </form>
    </div>
  )
}
