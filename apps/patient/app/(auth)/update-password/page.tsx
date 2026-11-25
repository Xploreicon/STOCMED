import { Suspense } from 'react'
import UpdatePassword from './update-password-form'

export const metadata = { title: 'Update password | StocMed' }

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>}><UpdatePassword /></Suspense>
}
