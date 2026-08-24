'use client'

import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'
import {
  getSafeNativeOAuthDestination,
  NATIVE_OAUTH_FLOW_STORAGE_KEY,
  NATIVE_OAUTH_PENDING_STORAGE_KEY,
  parseNativeOAuthCallback,
  parseNativeOAuthPending,
} from '@/lib/auth/native-oauth'

function oauthErrorPath(code: string) {
  const params = new URLSearchParams({ error: code })
  return `/login?${params.toString()}`
}

export function NativeOAuthBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let active = true
    let listener: Awaited<ReturnType<typeof App.addListener>> | undefined

    const handleUrl = async (rawUrl: string) => {
      const callback = parseNativeOAuthCallback(rawUrl)
      if (!callback) return

      let pending = parseNativeOAuthPending(
        window.localStorage.getItem(NATIVE_OAUTH_PENDING_STORAGE_KEY),
      )

      // Accept an already-started flow from the previous native implementation
      // while installed clients roll forward to the direct PKCE hand-off.
      if (!pending && callback.kind !== 'code' && callback.flow) {
        const expectedFlow = window.localStorage.getItem(NATIVE_OAUTH_FLOW_STORAGE_KEY)
        if (callback.flow === expectedFlow) {
          pending = {
            destination: callback.kind === 'session'
              ? callback.destination
              : '/dashboard',
            startedAt: Date.now(),
          }
        }
      }
      if (!pending) return

      window.localStorage.removeItem(NATIVE_OAUTH_PENDING_STORAGE_KEY)
      window.localStorage.removeItem(NATIVE_OAUTH_FLOW_STORAGE_KEY)

      try {
        await Browser.close()
      } catch {
        // The browser may already be closed after Android foregrounds the app.
      }

      if (callback.kind === 'error') {
        window.location.replace(oauthErrorPath(callback.code))
        return
      }

      const supabase = createClient()
      const sessionResult = callback.kind === 'code'
        ? await supabase.auth.exchangeCodeForSession(callback.code)
        : await supabase.auth.setSession({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
          })
      if (sessionResult.error || !sessionResult.data.session) {
        window.location.replace(oauthErrorPath('native_oauth_session_failed'))
        return
      }

      try {
        const response = await fetch('/auth/native/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ next: pending.destination }),
        })
        const result = await response.json() as { destination?: string; error?: string }
        if (!response.ok || !result.destination) {
          await supabase.auth.signOut({ scope: 'local' })
          window.location.replace(oauthErrorPath(result.error || 'native_oauth_role_check_failed'))
          return
        }
        window.location.replace(getSafeNativeOAuthDestination(result.destination))
      } catch {
        await supabase.auth.signOut({ scope: 'local' })
        window.location.replace(oauthErrorPath('native_oauth_role_check_failed'))
      }
    }

    void App.addListener('appUrlOpen', event => {
      if (active) void handleUrl(event.url)
    }).then(handle => {
      if (active) listener = handle
      else void handle.remove()
    })

    void App.getLaunchUrl().then(result => {
      if (active && result?.url) void handleUrl(result.url)
    })

    return () => {
      active = false
      if (listener) void listener.remove()
    }
  }, [])

  return null
}
