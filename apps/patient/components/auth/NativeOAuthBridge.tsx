'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'
import { nativeFetch } from '@/lib/api/client'
import { clearAuthIntent, readAuthIntent } from '@/lib/auth/native-oauth'
import { markRecoverySession } from '@/lib/auth/recovery'
import { createAuthCallbackHandler } from '@/lib/auth/callback'
import { useAuthContext } from './AuthProvider'

export function NativeOAuthBridge() {
  const { refreshProfile } = useAuthContext()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let listener: Awaited<ReturnType<typeof App.addListener>> | undefined
    const handleUrl = createAuthCallbackHandler({
      webOrigin: window.location.origin, readIntent: readAuthIntent, clearIntent: clearAuthIntent,
      exchange: async code => {
        if (!Capacitor.isNativePlatform()) {
          const current = new URL(window.location.href)
          for (const name of ['code', 'error', 'error_code', 'intent', 'auth_callback']) current.searchParams.delete(name)
          window.history.replaceState(null, '', `${current.pathname}${current.search}${current.hash}`)
        }
        return createClient().auth.exchangeCodeForSession(code)
      },
      closeBrowser: () => Browser.close(),
      complete: async next => {
        if (Capacitor.isNativePlatform()) {
          const response = await nativeFetch('/auth/native/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ next }) })
          const body = await response.json().catch(() => null) as { destination?: string } | null
          if (!response.ok || !body?.destination) throw new Error('Your account could not be checked. Please retry sign-in.')
          return body.destination
        }
        // Browser preview also resolves persisted profile through AuthProvider.
        return next
      },
      refreshProfile, setRecovery: () => markRecoverySession(true),
      discardSession: async () => { markRecoverySession(false); await createClient().auth.signOut({ scope: 'local' }) },
      navigate: next => { if (alive) router.replace(next) },
      reportError: message => { if (alive) setError(message) },
    })
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appUrlOpen', event => { if (alive) void handleUrl(event.url) })
        .then(handle => { if (alive) listener = handle; else void handle.remove() })
        .catch(() => { if (alive) setError('Sign-in links are unavailable. Please reopen the app.') })
      void App.getLaunchUrl().then(result => { if (alive && result?.url) void handleUrl(result.url) }).catch(() => {})
    } else {
      void handleUrl(window.location.href)
    }
    return () => { alive = false; void listener?.remove() }
  }, [refreshProfile, router])
  return error ? <div role="alert" className="fixed inset-x-3 top-3 z-50 mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-4 text-sm shadow-lg"><p>{error}</p><button type="button" className="mt-2 underline" onClick={() => { setError(null); router.replace('/login') }}>Back to sign in</button></div> : null
}
