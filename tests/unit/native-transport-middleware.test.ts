import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ updateSession: vi.fn(), handleNative: vi.fn() }))
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: mocks.updateSession }))
vi.mock('@/lib/native-patient-middleware', () => ({ handleNativePatientRequest: mocks.handleNative }))

import { middleware } from '@/middleware'

const nativeOrigin = 'capacitor://localhost'

function incoming(path: string, options: { origin?: string; bearer?: string; cookie?: string; method?: string; native?: boolean } = {}) {
  const headers = new Headers({ 'User-Agent': options.native ? 'Mozilla/5.0 StocMedApp/1.0' : 'Mozilla/5.0' })
  if (options.origin) headers.set('Origin', options.origin)
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`)
  if (options.cookie) headers.set('Cookie', options.cookie)
  return new NextRequest(`https://www.askstocmed.com${path}`, { method: options.method ?? 'GET', headers })
}

describe('native transport middleware', () => {
  beforeEach(() => {
    vi.stubEnv('NATIVE_ALLOWED_ORIGINS', `${nativeOrigin},https://localhost`)
    mocks.updateSession.mockReset()
    mocks.handleNative.mockReset()
    mocks.handleNative.mockResolvedValue(null)
    mocks.updateSession.mockImplementation(async () => {
      const response = NextResponse.next()
      return { supabaseResponse: response, user: null, supabase: {}, getSupabaseResponse: () => response }
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['https://evil.example', undefined])('rejects a bearer with origin %s before consulting a cookie', async origin => {
    const response = await middleware(incoming('/api/searches', { origin, bearer: 'bad-token', cookie: 'sb-auth=valid-cookie' }))
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('does not let an unrelated cookie identity replace an allowed bearer identity', async () => {
    const response = await middleware(incoming('/api/searches', {
      origin: nativeOrigin, bearer: 'patient-token', cookie: 'sb-auth=pharmacy-cookie',
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.updateSession).not.toHaveBeenCalled()
    // The route wrapper, tested separately with the real SDK, validates this
    // token before any handler executes; middleware does not authenticate it.
  })

  it('retains cookie session refresh and role-less redirect without a bearer', async () => {
    mocks.updateSession.mockImplementation(async () => {
      const response = NextResponse.next()
      return { supabaseResponse: response, user: { user_metadata: {} }, supabase: {}, getSupabaseResponse: () => response }
    })
    const response = await middleware(incoming('/api/searches', { cookie: 'sb-auth=roleless' }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://www.askstocmed.com/complete-profile')
    expect(mocks.updateSession).toHaveBeenCalledTimes(1)
  })

  it('does not bypass session middleware for routes outside the native transport allowlist', async () => {
    const response = await middleware(incoming('/api/pharmacy/profile', { origin: nativeOrigin, bearer: 'some-token' }))
    expect(response.status).toBe(200)
    expect(mocks.updateSession).toHaveBeenCalledTimes(1)
  })

  it.skipIf(!process.env.I1_BASELINE_ROOT).each(['/', '/signup', '/complete-profile', '/pharmacy/dashboard'])(
    'keeps ordinary-browser middleware status, headers and body for %s', async path => {
      const file = `${process.env.I1_BASELINE_ROOT}/middleware.ts`
      const old = await import(/* @vite-ignore */ file)
      const baseline = await old.middleware(incoming(path))
      const current = await middleware(incoming(path))
      expect(current.status).toBe(baseline.status)
      expect([...current.headers.entries()]).toEqual([...baseline.headers.entries()])
      expect(await current.text()).toBe(await baseline.text())
    },
  )
})
