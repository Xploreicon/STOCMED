import { Suspense } from 'react'
import ForgotPassword from './forgot-password-form'

export const metadata = { title: 'Reset password | StocMed' }

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>}><ForgotPassword /></Suspense>
}
