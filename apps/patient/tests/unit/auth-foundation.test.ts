import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
import { patientAccess } from '@/lib/auth/guard'
import { clearForAccountChange, registerAccountCache } from '@/lib/auth/account-cache'
import { parseAuthCallback, parseAuthIntent, safePatientDestination, AUTH_INTENT_STORAGE_KEY } from '@/lib/auth/native-oauth'
import { createAuthCallbackHandler } from '@/lib/auth/callback'
import { markRecoverySession, requestPasswordRecovery, updateRecoveryPassword, verifyRecoveryCode } from '@/lib/auth/recovery'
import { getPersistedProfile } from '@/lib/auth/profile'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientDatabase } from '@/lib/supabase/database'

const profile = { user_id: 'patient-id', role: 'patient', full_name: 'Synthetic', email: null, phone: null, location: null }
beforeEach(() => { vi.clearAllMocks(); markRecoverySession(false) })
afterEach(() => vi.unstubAllGlobals())
describe('persisted-profile state and account isolation', () => {
  it('surfaces a failed profile lookup for explicit retry instead of treating it as missing', async () => {
    const retry = vi.fn().mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ retry }) }) }) }) } as unknown as SupabaseClient<ClientDatabase>
    await expect(getPersistedProfile(client, 'A')).rejects.toThrow('could not be verified')
    expect(retry).toHaveBeenCalledWith(false)
    retry.mockResolvedValueOnce({ data: null, error: null })
    expect(await getPersistedProfile(client, 'A')).toBeNull()
  })
  it('distinguishes hydration, failed lookup, signed out, role-less, denied and patient', () => {
    const state = { loading: false, error: null, authenticated: true, profile }
    expect(patientAccess({ ...state, loading: true })).toBe('loading')
    expect(patientAccess({ ...state, error: 'lookup failed', profile: null })).toBe('error')
    expect(patientAccess({ ...state, authenticated: false, profile: null })).toBe('login')
    expect(patientAccess({ ...state, profile: null })).toBe('onboarding')
    expect(patientAccess({ ...state, profile: { ...profile, role: 'pharmacy' } })).toBe('denied')
    expect(patientAccess(state)).toBe('allowed')
  })
  it('clears registered owner caches and owner storage on sign-out/account switch, not token refresh', () => {
    const removeItem = vi.fn(); vi.stubGlobal('window', { localStorage: { removeItem } })
    const clear = vi.fn(); const stop = registerAccountCache(clear)
    try {
      expect(clearForAccountChange('A', 'A')).toBe(false); expect(clear).not.toHaveBeenCalled()
      expect(clearForAccountChange('A', 'B')).toBe(true); expect(clear).toHaveBeenCalledOnce()
      expect(clearForAccountChange('B', null)).toBe(true); expect(clear).toHaveBeenCalledTimes(2)
      expect(removeItem).toHaveBeenCalledWith('stocmed:userLocation'); expect(removeItem).toHaveBeenCalledWith('search-storage')
    } finally { stop() }
  })
  it('does not let denied storage or a failed cache prevent account isolation', () => {
    vi.stubGlobal('window', { localStorage: { removeItem: () => { throw new Error('storage denied') } } })
    const stop = registerAccountCache(() => { throw new Error('cache failure') })
    try { expect(() => clearForAccountChange('A', 'B')).not.toThrow() } finally { stop() }
  })
})

describe('native callback and recovery controller', () => {
  const now = 1000000
  const intent = (kind: 'google' | 'recovery' | 'confirmation' = 'google') => ({ status: 'valid' as const, intent: { kind, next: '/dashboard', startedAt: now } })
  const dependencies = () => ({ webOrigin: 'http://localhost:3197', readIntent: vi.fn(() => intent()), clearIntent: vi.fn(),
    exchange: vi.fn(async () => ({ error: null as Error | null, data: { session: {}, redirectType: null as string | null } })), closeBrowser: vi.fn(async () => {}),
    complete: vi.fn(async () => '/dashboard'), refreshProfile: vi.fn(async () => {}), setRecovery: vi.fn(), navigate: vi.fn(), reportError: vi.fn() })
  it.each(['https://evil.example/?code=a', 'com.askstocmed.patient://wrong?code=a', 'com.askstocmed.patient://user@auth-callback?code=a', 'com.askstocmed.patient://auth-callback:12?code=a', 'com.askstocmed.patient://auth-callback/other?code=a'])('rejects non-exact callback %s', raw => expect(parseAuthCallback(raw)).toBeNull())
  it('accepts only the explicit same-origin existing login callback in browser preview', () => {
    expect(parseAuthCallback('http://localhost:3197/login/?auth_callback=1&code=a', 'http://localhost:3197')).toMatchObject({ kind: 'code', code: 'a' })
    expect(parseAuthCallback('http://localhost:3197/login/?code=a', 'http://localhost:3197')).toBeNull()
  })
  it('allowlists exact patient routes with trailing slashes, query and hash', () => {
    expect(safePatientDestination('/search-results/?q=Panadol#results')).toBe('/search-results/?q=Panadol#results')
    for (const route of ['/pharmacies', '/pharmacy/dashboard', '/admin', '//evil.example', '/dashboard/unknown']) expect(safePatientDestination(route)).toBe('/dashboard')
  })
  it('reports unknown/expired/future intent explicitly without exchanging a code', async () => {
    expect(parseAuthIntent(null, now)).toEqual({ status: 'missing' })
    expect(parseAuthIntent(JSON.stringify({ kind: 'unknown', next: '/', startedAt: now }), now)).toEqual({ status: 'invalid' })
    expect(parseAuthIntent(JSON.stringify({ kind: 'google', next: '/', startedAt: now + 1 }), now)).toEqual({ status: 'invalid' })
    const expired = parseAuthIntent(JSON.stringify({ kind: 'google', next: '/', startedAt: 0 }), now)
    expect(expired).toEqual({ status: 'expired' })
    const deps = dependencies(); const readIntent = vi.fn(() => expired)
    expect(await createAuthCallbackHandler({ ...deps, readIntent })('com.askstocmed.patient://auth-callback?code=a')).toBe('error')
    expect(deps.exchange).not.toHaveBeenCalled(); expect(deps.reportError).toHaveBeenCalledWith(expect.stringContaining('expired'))
  })
  it('exchanges a code only once across concurrent and subsequent duplicate callbacks', async () => {
    const deps = dependencies(); let resolve!: () => void
    const pause = new Promise<void>(done => { resolve = done }); deps.exchange.mockImplementation(async () => { await pause; return { error: null, data: { session: {}, redirectType: null } } })
    const handle = createAuthCallbackHandler(deps); const first = handle('com.askstocmed.patient://auth-callback?code=once')
    expect(await handle('com.askstocmed.patient://auth-callback?code=once')).toBe('ignored')
    resolve(); expect(await first).toBe('completed')
    expect(await handle('com.askstocmed.patient://auth-callback?code=once')).toBe('ignored')
    expect(deps.exchange).toHaveBeenCalledOnce(); expect(deps.complete).toHaveBeenCalledOnce()
  })
  it('requires both a recovery intent and SDK-confirmed recovery flow', async () => {
    const deps = dependencies(); deps.readIntent.mockReturnValue(intent('recovery')); deps.exchange.mockResolvedValue({ error: null, data: { session: {}, redirectType: 'recovery' } })
    expect(await createAuthCallbackHandler(deps)('com.askstocmed.patient://auth-callback?code=recovery&intent=recovery')).toBe('completed')
    expect(deps.setRecovery).toHaveBeenCalledOnce(); expect(deps.navigate).toHaveBeenCalledWith('/update-password'); expect(deps.complete).not.toHaveBeenCalled()
    const rejected = dependencies(); rejected.readIntent.mockReturnValue(intent('recovery'))
    expect(await createAuthCallbackHandler(rejected)('com.askstocmed.patient://auth-callback?code=not-recovery')).toBe('error')
    expect(rejected.setRecovery).not.toHaveBeenCalled()
  })
  it('checks confirmation identity through the same authoritative completion and rejects intent mismatch', async () => {
    const deps = dependencies(); deps.readIntent.mockReturnValue(intent('confirmation'))
    expect(await createAuthCallbackHandler(deps)('com.askstocmed.patient://auth-callback?code=confirm&intent=confirmation')).toBe('completed')
    expect(deps.complete).toHaveBeenCalledWith('/dashboard'); expect(deps.setRecovery).not.toHaveBeenCalled()
    const wrong = dependencies()
    expect(await createAuthCallbackHandler(wrong)('com.askstocmed.patient://auth-callback?code=a&intent=unknown')).toBe('error'); expect(wrong.exchange).not.toHaveBeenCalled()
  })
  it('surfaces exchange refusal without navigating, and ignores unsolicited non-callback URLs', async () => {
    const deps = dependencies(); deps.exchange.mockResolvedValue({ error: new Error('refused'), data: { session: {}, redirectType: null } })
    const handle = createAuthCallbackHandler(deps)
    expect(await handle('com.askstocmed.patient://auth-callback?code=bad')).toBe('error'); expect(deps.navigate).not.toHaveBeenCalled()
    expect(await handle('com.askstocmed.patient://other?code=bad')).toBe('ignored')
  })
  it('discards only a newly exchanged session after authoritative completion refusal', async () => {
    const deps = dependencies(); const discardSession = vi.fn(async () => {})
    deps.complete.mockRejectedValue(new Error('account completion refused'))
    expect(await createAuthCallbackHandler({ ...deps, discardSession })('com.askstocmed.patient://auth-callback?code=new-session')).toBe('error')
    expect(discardSession).toHaveBeenCalledOnce(); expect(deps.navigate).not.toHaveBeenCalled()
    const refused = dependencies(); refused.exchange.mockResolvedValue({ error: new Error('code refused'), data: { session: {}, redirectType: null } })
    discardSession.mockClear()
    expect(await createAuthCallbackHandler({ ...refused, discardSession })('com.askstocmed.patient://auth-callback?code=invalid')).toBe('error')
    expect(discardSession).not.toHaveBeenCalled()
  })
  it('requests a code without a deep-link redirect and keeps ordinary sessions gated', async () => {
    const removeItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { removeItem } })
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    expect(await requestPasswordRecovery(' Fixture@example.invalid ')).toEqual({ error: null })
    expect(removeItem).toHaveBeenCalledWith(AUTH_INTENT_STORAGE_KEY)
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('fixture@example.invalid')
    expect((await updateRecoveryPassword('new-test-password')).error).toBeInstanceOf(Error)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('uses recovery-only OTP verification and rejects malformed or expired codes', async () => {
    expect((await verifyRecoveryCode('fixture@example.invalid', 'abc123456')).error).toBeInstanceOf(Error)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: new Error('expired') })
    expect((await verifyRecoveryCode('fixture@example.invalid', '123-456')).error?.message).toContain('expired')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'fixture@example.invalid', token: '123456', type: 'recovery' })
    expect((await updateRecoveryPassword('new-test-password')).error).toBeInstanceOf(Error)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('consumes the confirmed recovery session after a password change', async () => {
    markRecoverySession(true)
    auth.updateUser.mockResolvedValue({ error: null })
    expect(await updateRecoveryPassword('new-test-password')).toEqual({ error: null })
    expect((await updateRecoveryPassword('other-test-password')).error).toBeInstanceOf(Error)
    expect(auth.updateUser).toHaveBeenCalledOnce()
  })
})
