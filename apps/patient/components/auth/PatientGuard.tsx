'use client'
import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { patientAccess } from '@/lib/auth/guard'
import { safePatientDestination } from '@/lib/auth/native-oauth'

export function PatientGuard({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const access = patientAccess({ loading: auth.loading, error: auth.error, authenticated: Boolean(auth.user), profile: auth.profile })
  useEffect(() => {
    if (access === 'login') router.replace(`/login?redirectTo=${encodeURIComponent(safePatientDestination(pathname))}`)
    if (access === 'onboarding') router.replace('/complete-profile')
  }, [access, pathname, router])
  if (access === 'allowed') return <>{children}</>
  if (access === 'error') return <div role="alert" className="mx-auto max-w-md space-y-4 p-6"><p>{auth.error}</p><button type="button" className="underline" onClick={() => void auth.refreshProfile()}>Retry account check</button></div>
  if (access === 'denied') return <div className="mx-auto max-w-md space-y-4 p-6"><h1 className="text-xl font-semibold">Patient accounts only</h1><p>This app is for patient accounts. Sign in with your patient account to continue.</p><button type="button" className="underline" onClick={() => void auth.signOut().catch(() => {})}>Sign out</button></div>
  return <p role="status" className="p-6 text-center">Checking your account…</p>
}
