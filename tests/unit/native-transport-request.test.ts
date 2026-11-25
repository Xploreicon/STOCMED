import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cookieClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieClient }))

import {
  createRequestClient,
  nativeOptions,
  withNativeTransport,
} from '@/lib/supabase/request'

const IOS = 'capacitor://localhost'
const ANDROID = 'https://localhost'
const SUPABASE = 'https://example.supabase.co'
const TOKEN = 'test.access.token'
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  app_metadata: { provider: 'google' },
  user_metadata: { role: 'patient' },
  created_at: '2026-01-01T00:00:00Z',
}

function request(origin: string | undefined, token: string | null = TOKEN) {
  const headers = new Headers()
  if (origin) headers.set('Origin', origin)
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  return new Request('https://www.askstocmed.com/api/searches', { headers })
}

describe('native transport with the real Supabase SDK', () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; apikey: string | null }> = []

  beforeEach(() => {
    seen.length = 0
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-anon-key')
    vi.stubEnv('NATIVE_ALLOWED_ORIGINS', `${IOS},${ANDROID}`)
    mocks.cookieClient.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      seen.push({ url: req.url, method: req.method, authorization: req.headers.get('Authorization'), apikey: req.headers.get('apikey') })
      if (url.pathname === '/auth/v1/user') {
        if (req.headers.get('Authorization') !== `Bearer ${TOKEN}`) {
          return Response.json({ msg: 'invalid token' }, { status: 401 })
        }
        return Response.json(user)
      }
      if (url.pathname === '/rest/v1/rpc/test_rpc') return Response.json({ ok: true })
      return Response.json({ error: 'unexpected request' }, { status: 500 })
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([IOS, ANDROID])('validates and uses the user JWT for requests from %s', async origin => {
    const handler = withNativeTransport(async req => {
      const client = await createRequestClient(req)
      const result = await client.rpc('test_rpc' as never)
      return Response.json({ data: result.data, error: result.error })
    })

    const response = await handler(request(origin))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true }, error: null })
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(seen.filter(item => item.url.endsWith('/auth/v1/user')).length).toBeGreaterThan(0)
    const rpc = seen.find(item => item.url.endsWith('/rest/v1/rpc/test_rpc'))
    expect(rpc).toMatchObject({ authorization: `Bearer ${TOKEN}`, apikey: 'public-test-anon-key' })
    expect(mocks.cookieClient).not.toHaveBeenCalled()
  })

  it('leaves the cookie client and its response unchanged without a bearer token', async () => {
    const cookie = { marker: 'cookie-client' }
    mocks.cookieClient.mockResolvedValue(cookie)
    const handler = withNativeTransport(async req => {
      const client = await createRequestClient(req)
      expect(client).toBe(cookie)
      return new Response('{"cookie":true}', { status: 202, headers: { 'content-type': 'application/json' } })
    })
    const response = await handler(request(undefined, null))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('{"cookie":true}')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(mocks.cookieClient).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
  })

  it.each(['https://evil.example', 'https://localhost.evil.example', undefined])(
    'rejects a bearer from origin %s without falling back to cookies', async origin => {
      const handler = withNativeTransport(async () => new Response('unexpected'))
      const response = await handler(request(origin))
      expect([401, 403]).toContain(response.status)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(mocks.cookieClient).not.toHaveBeenCalled()
      expect(seen).toHaveLength(0)
    },
  )

  it('rejects an invalid token even for an allowed origin', async () => {
    const handler = withNativeTransport(async () => new Response('unexpected'))
    const response = await handler(request(IOS, 'invalid.token.value'))
    expect([401, 403]).toContain(response.status)
    expect(await response.text()).not.toBe('unexpected')
    expect(mocks.cookieClient).not.toHaveBeenCalled()
  })

  it('never falls back to a valid cookie when a native bearer is invalid', async () => {
    const cookie = { marker: 'cookie-client' }
    mocks.cookieClient.mockResolvedValue(cookie)
    const req = request(IOS, 'invalid.token.value')
    req.headers.set('Cookie', 'sb-auth=valid-cookie')
    const handler = withNativeTransport(async () => new Response('unexpected'))
    const response = await handler(req)
    expect([401, 403]).toContain(response.status)
    expect(mocks.cookieClient).not.toHaveBeenCalled()
    expect(await response.text()).not.toBe('unexpected')
  })

  it('fails closed when no native origins have been configured', async () => {
    delete process.env.NATIVE_ALLOWED_ORIGINS
    const handler = withNativeTransport(async () => new Response('unexpected'))
    const response = await handler(request(IOS))
    expect([401, 403]).toContain(response.status)
    expect(seen).toHaveLength(0)
    expect(mocks.cookieClient).not.toHaveBeenCalled()
  })

  it.each(['*', 'null', '*,null'])(
    'does not allow a wildcard or null origin from configuration %s', async config => {
      vi.stubEnv('NATIVE_ALLOWED_ORIGINS', config)
      const handler = withNativeTransport(async () => new Response('unexpected'))
      for (const origin of ['https://evil.example', 'null']) {
        const response = await handler(request(origin))
        expect([401, 403]).toContain(response.status)
        expect(response.headers.get('access-control-allow-origin')).toBeNull()
      }
      expect(seen).toHaveLength(0)
    },
  )

  it.each(['Bearer', 'Bearer two tokens'])(
    'rejects malformed bearer authorization %s', async authorization => {
      const req = new Request('https://www.askstocmed.com/api/searches', {
        headers: { Origin: IOS, Authorization: authorization },
      })
      const handler = withNativeTransport(async () => new Response('unexpected'))
      const response = await handler(req)
      expect([401, 403]).toContain(response.status)
      expect(await response.text()).not.toBe('unexpected')
      expect(mocks.cookieClient).not.toHaveBeenCalled()
    },
  )

  it.each([IOS, ANDROID])('handles native preflight for %s without credentials or wildcard', async origin => {
    const response = await nativeOptions(new Request('https://www.askstocmed.com/api/searches', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    }))
    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(300)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
    expect(response.headers.get('vary')?.toLowerCase()).toContain('origin')
  })

  it('does not authorize an unlisted preflight origin', async () => {
    const response = await nativeOptions(new Request('https://www.askstocmed.com/api/searches', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    }))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it.each([
    { method: 'DELETE', headers: 'authorization,content-type' },
    { method: 'POST', headers: 'authorization,x-unapproved-header' },
  ])('fails a preflight with an unapproved method or header: $method $headers', async ({ method, headers }) => {
    const response = await nativeOptions(new Request('https://www.askstocmed.com/api/searches', {
      method: 'OPTIONS',
      headers: { Origin: IOS, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': headers },
    }))
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-methods')).toBeNull()
    expect(response.headers.get('access-control-allow-headers')).toBeNull()
  })
})
