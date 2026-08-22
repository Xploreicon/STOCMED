'use client'

import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'
import {
  NATIVE_OAUTH_FLOW_STORAGE_KEY,
  parseNativeOAuthCallback,
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

      const expectedFlow = window.localStorage.getItem(NATIVE_OAUTH_FLOW_STORAGE_KEY)
      if (callback.flow !== expectedFlow) return
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

      const { error } = await createClient().auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      })
      if (error) {
        window.location.replace(oauthErrorPath('native_oauth_session_failed'))
        return
      }

      window.location.replace(callback.destination)
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
