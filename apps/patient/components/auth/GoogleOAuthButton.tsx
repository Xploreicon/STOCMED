'use client'
import { useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'
import { clearAuthIntent, getAuthRedirectUrl, rememberAuthIntent } from '@/lib/auth/native-oauth'

export function GoogleOAuthButton({ next, onError }: { next?: string | null; onError?: (message: string) => void }) {
  const [loading, setLoading] = useState(false)
  const continueWithGoogle = async () => {
    if (loading) return
    setLoading(true); onError?.('')
    try {
      rememberAuthIntent('google', next)
      const { data, error } = await createClient().auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: getAuthRedirectUrl('google'), skipBrowserRedirect: true, scopes: 'openid email profile', queryParams: { prompt: 'select_account' },
      } })
      if (error || !data.url) throw new Error('Google sign-in could not be started. Please retry.')
      if (Capacitor.isNativePlatform()) await Browser.open({ url: data.url, toolbarColor: '#0066CC' })
      else window.location.assign(data.url)
    } catch (cause) {
      clearAuthIntent(); onError?.(cause instanceof Error ? cause.message : 'Google sign-in could not be started.')
    } finally { setLoading(false) }
  }
  return <button type="button" disabled={loading} onClick={() => void continueWithGoogle()} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium disabled:opacity-60"><span aria-hidden="true" className="text-lg font-bold text-blue-600">G</span>{loading ? 'Connecting to Google…' : 'Continue with Google'}</button>
}
