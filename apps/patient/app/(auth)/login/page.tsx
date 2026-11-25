import { Suspense } from 'react'
import LoginForm from './login-form'

export const metadata = { title: 'Sign in | StocMed' }

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>}><LoginForm /></Suspense>
}
