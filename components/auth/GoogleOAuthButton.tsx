'use client'

import { useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'
import { NativeOAuthBridge } from '@/components/auth/NativeOAuthBridge'
import {
  buildNativeOAuthPending,
  getNativeGoogleOAuthOptions,
  NATIVE_OAUTH_PENDING_STORAGE_KEY,
} from '@/lib/auth/native-oauth'

type GoogleOAuthButtonProps = {
  next?: string | null
  onError?: (message: string) => void
}

function safeNextPath(value?: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : null
}

export function GoogleOAuthButton({
  next,
  onError,
}: GoogleOAuthButtonProps) {
  const [loading, setLoading] = useState(false)

  const continueWithGoogle = async () => {
    setLoading(true)
    onError?.('')

    if (Capacitor.isNativePlatform()) {
      let browserFinished: Awaited<ReturnType<typeof Browser.addListener>> | undefined
      try {
        window.localStorage.setItem(
          NATIVE_OAUTH_PENDING_STORAGE_KEY,
          buildNativeOAuthPending(next),
        )
        browserFinished = await Browser.addListener('browserFinished', () => {
          setLoading(false)
          if (browserFinished) void browserFinished.remove()
        })

        const { data, error } = await createClient().auth.signInWithOAuth({
          provider: 'google',
          options: getNativeGoogleOAuthOptions(),
        })
        if (error || !data.url) {
          throw error ?? new Error('Google sign-in did not return an authorization URL.')
        }

        await Browser.open({ url: data.url, toolbarColor: '#0066CC' })
      } catch (error) {
        if (browserFinished) void browserFinished.remove()
        window.localStorage.removeItem(NATIVE_OAUTH_PENDING_STORAGE_KEY)
        setLoading(false)
        onError?.(error instanceof Error ? error.message : 'Google sign-in could not be started.')
      }
      return
    }

    const callback = new URL('/auth-callback', window.location.origin)
    const safeNext = safeNextPath(next)
    if (safeNext) callback.searchParams.set('next', safeNext)

    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        scopes: 'openid email profile',
        queryParams: {
          prompt: 'select_account',
        },
      },
    })

    if (error) {
      setLoading(false)
      onError?.(error.message || 'Google sign-in could not be started.')
    }
  }

  return (
    <>
      <NativeOAuthBridge />
      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={loading}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-button border border-[#747775] bg-white px-4 text-[15px] font-medium text-[#1f1f1f] transition-colors hover:bg-[#f8fafd] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
          <path fill="#EA4335" d="M10 8.18v3.87h5.38c-.24 1.24-.94 2.29-1.99 3l3.22 2.5c1.88-1.74 2.97-4.3 2.97-7.34 0-.71-.06-1.4-.18-2.03H10Z" />
          <path fill="#4285F4" d="M10 19.75c2.7 0 4.96-.89 6.61-2.41l-3.22-2.5c-.89.6-2.03.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13l-3.33 2.58A9.99 9.99 0 0 0 10 19.75Z" />
          <path fill="#FBBC05" d="M4.39 11.67A5.98 5.98 0 0 1 4.08 10c0-.58.1-1.14.3-1.67L1.06 5.75A9.98 9.98 0 0 0 0 10c0 1.61.38 3.14 1.06 4.25l3.33-2.58Z" />
          <path fill="#34A853" d="M10 4.2c1.47 0 2.78.5 3.82 1.5l2.86-2.87C14.95 1.21 12.69.25 10 .25a9.99 9.99 0 0 0-8.94 5.5l3.33 2.58C5.18 5.96 7.39 4.2 10 4.2Z" />
        </svg>
        {loading ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
    </>
  )
}
