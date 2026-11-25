'use client'
import { useMemo } from 'react'
import { useAuth } from './useAuth'

export function useUser() {
  const { user: authUser, profile, loading, error } = useAuth()
  const role = profile?.role
  const user = useMemo(() => authUser ? { ...authUser, role, full_name: profile?.full_name || null, location: profile?.location || null } : null,
    [authUser, role, profile?.full_name, profile?.location])
  return { user, loading, isLoading: loading, error, role, isPatient: role === 'patient', isPharmacy: role === 'pharmacy' }
}
