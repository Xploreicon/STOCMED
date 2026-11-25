'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getPersistedProfile, type PatientProfile } from '@/lib/auth/profile'
import { markRecoverySession } from '@/lib/auth/recovery'
import { clearAccountCaches, clearForAccountChange } from '@/lib/auth/account-cache'
import { subscribeAuthRevalidation } from '@/lib/auth/revalidation'
import { NativeOAuthBridge } from './NativeOAuthBridge'

export type AuthState = {
  user: User | null; session: Session | null; profile: PatientProfile | null
  loading: boolean; error: string | null; recovery: boolean
  refreshProfile: () => Promise<void>; signOut: () => Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)
export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const generation = useRef(0)
  const alive = useRef(false)
  const previousId = useRef<string | null>(null)
  const invalidateGeneration = useCallback(() => { generation.current += 1 }, [])

  const refreshProfile = useCallback(async () => {
    const sequence = ++generation.current
    try {
      const client = createClient()
      const { data: { session: current }, error: sessionError } = await client.auth.getSession()
      if (!alive.current || sequence !== generation.current) return
      if (sessionError) throw sessionError
      if (!current) {
        clearForAccountChange(previousId.current, null); previousId.current = null
        if (alive.current && sequence === generation.current) { setUser(null); setSession(null); setProfile(null); setError(null); setLoading(false) }
        return
      }
      const { data: { user: verified }, error: userError } = await client.auth.getUser()
      if (userError || !verified) throw new Error('Your session could not be verified. Please sign in again.')
      if (!alive.current || sequence !== generation.current) return
      if (current.user.id !== verified.id) throw new Error('Your account changed. Please retry the account check.')
      const persisted = await getPersistedProfile(client, verified.id)
      if (!alive.current || sequence !== generation.current) return
      setUser(verified); setSession(current); setProfile(persisted); setError(null); setLoading(false)
    } catch (cause) {
      if (!alive.current || sequence !== generation.current) return
      setProfile(null); setError(cause instanceof Error ? cause.message : 'Your account could not be verified.'); setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await createClient().auth.signOut()
    if (signOutError) throw new Error('Sign-out could not be completed. Please retry.')
    generation.current++; markRecoverySession(false); setRecovery(false)
    clearAccountCaches(); previousId.current = null
    setUser(null); setSession(null); setProfile(null); setError(null); setLoading(false)
  }, [])

  useEffect(() => {
    alive.current = true
    let unsubscribe: (() => void) | undefined
    let stateListener: { remove(): Promise<void> } | undefined
    try {
      const client = createClient()
      const stopRevalidation = subscribeAuthRevalidation(() => { queueMicrotask(() => { if (alive.current) void refreshProfile() }) })
      const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
        const changed = clearForAccountChange(previousId.current, nextSession?.user.id || null)
        previousId.current = nextSession?.user.id || null
        if (changed || !nextSession) setProfile(null)
        if (changed && nextSession) { setLoading(true); setError(null) }
        setSession(nextSession); setUser(nextSession?.user || null)
        if (event === 'PASSWORD_RECOVERY') { markRecoverySession(true); setRecovery(true) }
        else if (!nextSession || changed || event === 'SIGNED_IN') { markRecoverySession(false); setRecovery(false) }
        // Avoid awaiting Auth APIs from inside the SDK's locked callback.
        queueMicrotask(() => { if (alive.current) void refreshProfile() })
      })
      unsubscribe = () => { subscription.unsubscribe(); stopRevalidation() }
      void refreshProfile()
      void import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) { void client.auth.startAutoRefresh(); void refreshProfile() }
        else void client.auth.stopAutoRefresh()
      })).then(listener => { if (alive.current) stateListener = listener; else void listener.remove() }).catch(() => {})
    } catch (cause) { setLoading(false); setError(cause instanceof Error ? cause.message : 'Sign-in is unavailable.') }
    return () => { alive.current = false; invalidateGeneration(); unsubscribe?.(); void stateListener?.remove() }
  }, [refreshProfile, invalidateGeneration])

  const value = useMemo(() => ({ user, session, profile, loading, error, recovery, refreshProfile, signOut }),
    [user, session, profile, loading, error, recovery, refreshProfile, signOut])
  return <AuthContext.Provider value={value}><NativeOAuthBridge />{children}</AuthContext.Provider>
}
