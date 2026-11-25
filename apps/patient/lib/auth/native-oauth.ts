import { Capacitor } from '@capacitor/core'

export const NATIVE_OAUTH_CALLBACK_URL = 'com.askstocmed.patient://auth-callback'
export const AUTH_INTENT_STORAGE_KEY = 'stocmed:patient:auth-intent:v1'
export type AuthIntentKind = 'google' | 'recovery' | 'confirmation'
export type AuthIntent = { kind: AuthIntentKind; next: string; startedAt: number }
export type IntentResult = { status: 'valid'; intent: AuthIntent } | { status: 'missing' | 'invalid' | 'expired' }
export type AuthCallback = { kind: 'code'; code: string; intent?: string } | { kind: 'error'; error: string; intent?: string }
export const PATIENT_ROUTES = ['/', '/login', '/signup', '/forgot-password', '/update-password', '/complete-profile',
  '/dashboard', '/chat', '/history', '/reservations', '/profile', '/settings', '/search-results',
  '/about', '/privacy', '/terms', '/account/delete'] as const

export function safePatientDestination(value?: string | null, fallback = '/dashboard') {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  const url = new URL(value, 'https://patient.invalid')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (url.origin !== 'https://patient.invalid' || !PATIENT_ROUTES.some(path => path === pathname)) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}

export function parseAuthIntent(value: string | null, now = Date.now()): IntentResult {
  if (!value) return { status: 'missing' }
  try {
    const data = JSON.parse(value) as Partial<AuthIntent>
    if (!['google', 'recovery', 'confirmation'].includes(data.kind || '') || typeof data.startedAt !== 'number'
        || !Number.isFinite(data.startedAt) || data.startedAt > now || typeof data.next !== 'string') return { status: 'invalid' }
    if (now - data.startedAt > 15 * 60 * 1000) return { status: 'expired' }
    return { status: 'valid', intent: { kind: data.kind as AuthIntentKind, startedAt: data.startedAt, next: safePatientDestination(data.next) } }
  } catch { return { status: 'invalid' } }
}

export function rememberAuthIntent(kind: AuthIntentKind, next?: string | null) {
  const intent: AuthIntent = { kind, next: safePatientDestination(next), startedAt: Date.now() }
  window.localStorage.setItem(AUTH_INTENT_STORAGE_KEY, JSON.stringify(intent))
  return intent
}
export function readAuthIntent() { return parseAuthIntent(window.localStorage.getItem(AUTH_INTENT_STORAGE_KEY)) }
export function clearAuthIntent() { window.localStorage.removeItem(AUTH_INTENT_STORAGE_KEY) }

export function getAuthRedirectUrl(kind: AuthIntentKind) {
  const callback = Capacitor.isNativePlatform() ? new URL(NATIVE_OAUTH_CALLBACK_URL)
    : new URL('/login/', window.location.origin)
  if (!Capacitor.isNativePlatform()) callback.searchParams.set('auth_callback', '1')
  callback.searchParams.set('intent', kind)
  return callback.href
}

export function parseAuthCallback(raw: string, webOrigin?: string): AuthCallback | null {
  try {
    const url = new URL(raw)
    if (url.username || url.password) return null
    const native = url.protocol === 'com.askstocmed.patient:' && url.hostname === 'auth-callback' && !url.port && (!url.pathname || url.pathname === '/')
    const web = webOrigin && url.origin === webOrigin && ['/login', '/login/'].includes(url.pathname) && url.searchParams.get('auth_callback') === '1'
    if (!native && !web) return null
    const intent = url.searchParams.get('intent') || undefined
    const error = url.searchParams.get('error_code') || url.searchParams.get('error')
    if (error) return { kind: 'error', error: 'The sign-in link could not be completed. Please try again.', intent }
    const code = url.searchParams.get('code')
    return code && code.length <= 4096 && !/\s/.test(code) ? { kind: 'code', code, intent } : null
  } catch { return null }
}

/** Same code delivered by appUrlOpen and getLaunchUrl must exchange only once. */
export function createCallbackDeduplicator() {
  const seen = new Set<string>()
  return (code: string) => {
    if (seen.has(code)) return false
    seen.add(code)
    return true
  }
}
