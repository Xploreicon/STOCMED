import { Suspense } from 'react'
import SignupForm from './signup-form'

export const metadata = { title: 'Create a patient account | StocMed' }

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-ink-muted">Loading signup…</div>}><SignupForm /></Suspense>
}
