import { Suspense } from 'react'
import CompleteProfileForm from './complete-profile-form'

export const metadata = { title: 'Complete your profile | StocMed' }

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-ink-muted">Loading your account…</div>}><CompleteProfileForm /></Suspense>
}
