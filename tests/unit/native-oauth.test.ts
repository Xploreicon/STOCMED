import { describe, expect, it } from 'vitest'
import {
  buildNativeOAuthPending,
  buildNativeOAuthErrorUrl,
  buildNativeOAuthSessionUrl,
  getNativeGoogleOAuthOptions,
  getSafeNativeOAuthDestination,
  isNativeOAuthFlow,
  parseNativeOAuthCallback,
  parseNativeOAuthPending,
} from '@/lib/auth/native-oauth'

const FLOW = '6f9d53a4-7dfa-4d7c-9189-236d8213694f'

describe('native OAuth deep links', () => {
  it('starts native Google OAuth with an exact custom-scheme PKCE redirect', () => {
    expect(getNativeGoogleOAuthOptions()).toEqual({
      redirectTo: 'com.askstocmed.patient://auth-callback',
      skipBrowserRedirect: true,
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    })
  })

  it('parses the PKCE code Supabase returns to the native scheme', () => {
    expect(parseNativeOAuthCallback(
      'com.askstocmed.patient://auth-callback?code=pkce-auth-code',
    )).toEqual({ kind: 'code', code: 'pkce-auth-code' })
  })

  it('parses a token callback for a pending native hand-off', () => {
    expect(parseNativeOAuthCallback(
      'com.askstocmed.patient://auth-callback#access_token=access&refresh_token=refresh',
    )).toEqual({
      kind: 'session',
      accessToken: 'access',
      refreshToken: 'refresh',
      destination: '/dashboard',
    })
  })

  it('keeps session credentials in the fragment and parses the expected callback', () => {
    const callback = buildNativeOAuthSessionUrl({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      flow: FLOW,
      destination: '/history?from=oauth',
    })

    expect(callback).toMatch(/^com\.askstocmed\.patient:\/\/auth-callback#/)
    expect(callback.split('#')[0]).not.toContain('token')
    expect(parseNativeOAuthCallback(callback)).toEqual({
      kind: 'session',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      flow: FLOW,
      destination: '/history?from=oauth',
    })
  })

  it('parses an error callback without accepting another scheme or host', () => {
    expect(parseNativeOAuthCallback(buildNativeOAuthErrorUrl(FLOW, 'oauth_failed'))).toEqual({
      kind: 'error',
      code: 'oauth_failed',
      flow: FLOW,
    })
    expect(parseNativeOAuthCallback(`other.app://auth-callback#flow=${FLOW}`)).toBeNull()
    expect(parseNativeOAuthCallback(`com.askstocmed.patient://other#flow=${FLOW}`)).toBeNull()
  })

  it('requires a version-4 flow correlator', () => {
    expect(isNativeOAuthFlow(FLOW)).toBe(true)
    expect(isNativeOAuthFlow('not-a-flow')).toBe(false)
  })

  it('retains a short-lived safe destination while OAuth is in progress', () => {
    const startedAt = 2_000_000
    const pending = buildNativeOAuthPending('/history?from=oauth', startedAt)

    expect(parseNativeOAuthPending(pending, startedAt + 60_000)).toEqual({
      destination: '/history?from=oauth',
      startedAt,
    })
    expect(parseNativeOAuthPending(pending, startedAt + 16 * 60_000)).toBeNull()
    expect(parseNativeOAuthPending(
      buildNativeOAuthPending('/pharmacy/dashboard', startedAt),
      startedAt,
    )?.destination).toBe('/')
  })

  it('keeps destinations same-origin and out of privileged surfaces', () => {
    expect(getSafeNativeOAuthDestination('/dashboard')).toBe('/dashboard')
    expect(getSafeNativeOAuthDestination('/pharmacy/dashboard')).toBe('/')
    expect(getSafeNativeOAuthDestination('/admin')).toBe('/')
    expect(getSafeNativeOAuthDestination('/auth/native/start')).toBe('/dashboard')
    expect(getSafeNativeOAuthDestination('/auth-callback')).toBe('/dashboard')
    expect(getSafeNativeOAuthDestination('//evil.example')).toBe('/dashboard')
    expect(getSafeNativeOAuthDestination('https://evil.example')).toBe('/dashboard')
  })
})
