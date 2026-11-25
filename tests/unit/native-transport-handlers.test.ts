import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  cookieClient: vi.fn(),
  getAdminClient: vi.fn(),
  sendReservationNotifications: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieClient }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: mocks.getAdminClient }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }) }))
vi.mock('@/lib/notifications/reservations', () => ({ sendReservationNotifications: mocks.sendReservationNotifications }))
vi.mock('@/lib/triage/classifier', () => ({
  triageQuery: vi.fn(async () => ({ intent: 'NAMED_OTC', risk_tier: 'ALLOW', confidence: 1, layers_triggered: [] })),
}))
vi.mock('@/lib/anthropic', () => ({
  ClaudeRequestError: class ClaudeRequestError extends Error {},
  DEFAULT_CLAUDE_MODEL: 'test',
  getAnthropicClient: vi.fn(),
  reportClaudeFailure: vi.fn(),
  toClaudeRequestError: vi.fn(),
  toClaudeEmptyResponseError: vi.fn(),
}))

import * as searches from '@/app/api/searches/route'
import * as triage from '@/app/api/triage/route'
import * as assistant from '@/app/api/chat/assistant/route'
import * as drugs from '@/app/api/drugs/search/route'
import * as reservations from '@/app/api/reservations/route'
import * as prescription from '@/app/api/reservations/prescription/route'
import * as preferences from '@/app/api/notifications/preferences/route'
import * as privacy from '@/app/api/privacy/delete-my-data/route'
import * as completion from '@/app/auth/native/complete/route'

const SUPABASE = 'https://example.supabase.co'
const ORIGIN = 'capacitor://localhost'
const TOKEN = 'test.access.token'
const USER = '11111111-1111-4111-8111-111111111111'
const INVENTORY = '22222222-2222-4222-8222-222222222222'
const PHARMACY = '33333333-3333-4333-8333-333333333333'
const prefs = {
  product_email_opt_in: false, refill_email_opt_in: false, reminder_sms_opt_in: false,
  patient_email_consent: false, patient_sms_consent: false, patient_push_consent: false,
}
let role: 'patient' | 'pharmacy' | undefined
let persistedRole: 'patient' | 'pharmacy' | undefined
let authCalls: Array<{ method: string; authorization: string | null; apikey: string | null; body: string }>
let storedFile: { path: string; bytes: Uint8Array } | null
let roleSyncFails: boolean

function authUser() {
  return {
    id: USER, aud: 'authenticated', app_metadata: { provider: 'google' },
    user_metadata: role ? { role } : {}, created_at: '2026-01-01T00:00:00Z',
  }
}

function adminClient() {
  const adminData: Record<string, unknown> = {
    rx_retention_policy: { retention_days: 365, is_confirmed: true },
    pharmacy_inventory: {
      id: INVENTORY, pharmacy_id: PHARMACY, is_listed: true, deleted_at: null,
      products: { generic_name: 'amoxicillin', requires_prescription: true, is_verified: true },
    },
    pharmacies: {
      id: PHARMACY, user_id: USER, reservations_enabled: true, is_active: true,
      is_verified: true, is_test_account: true, verification_status: 'full',
      verification_authorized_at: '2026-01-01T00:00:00Z', verification_authorization_basis: 'review',
    },
    users: { is_licensed_pharmacist: true, pharmacist_license_verified_at: '2026-01-01T00:00:00Z', pharmacist_license_verification_basis: 'review' },
    rx_submissions: { id: INVENTORY, status: 'submitted' },
    private_file_deletion_queue: [],
  }
  const from = (table: string) => {
    const builder: any = {
      select: () => builder, eq: () => builder, is: () => builder,
      insert: () => builder, delete: () => builder, update: () => builder,
      maybeSingle: async () => ({ data: adminData[table] ?? null, error: null }),
      single: async () => ({ data: adminData[table] ?? null, error: null }),
      limit: async () => ({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: adminData[table] ?? null, error: null }).then(resolve),
    }
    return builder
  }
  return {
    from,
    rpc: async (name: string) => ({ data: name === 'reservation_sellable_quantities' ? [{ sellable_quantity: 4 }] : [], error: null }),
    storage: { from: () => ({
      upload: async (path: string, bytes: Uint8Array) => { storedFile = { path, bytes }; return { error: null } },
      remove: async () => ({ error: null }),
    }) },
  }
}

const paths = [
  ['/api/searches', searches], ['/api/triage', triage], ['/api/chat/assistant', assistant],
  ['/api/drugs/search', drugs], ['/api/reservations', reservations],
  ['/api/reservations/prescription', prescription], ['/api/notifications/preferences', preferences],
  ['/api/privacy/delete-my-data', privacy], ['/auth/native/complete', completion],
] as const

function input(path: string, method: string, bearer = false, origin?: string, body?: unknown) {
  const headers = new Headers({ 'User-Agent': bearer || path === '/auth/native/complete' ? 'Mozilla/5.0 StocMedApp/1.0' : 'Mozilla/5.0' })
  if (bearer) headers.set('Authorization', `Bearer ${TOKEN}`)
  if (origin) headers.set('Origin', origin)
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  return new NextRequest(`https://www.askstocmed.com${path}`, {
    method, headers,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  })
}

type Handler = (request: NextRequest) => Promise<Response>
type Case = { path: string; method: string; handler: Handler; body?: unknown; status: number; expected: unknown }
const cases: Case[] = [
  { path: '/api/searches', method: 'GET', handler: searches.GET, status: 200, expected: [] },
  { path: '/api/searches', method: 'POST', handler: searches.POST, body: { query: 'panadol' }, status: 201, expected: { success: true } },
  { path: '/api/triage', method: 'POST', handler: triage.POST, body: { query: 'panadol' }, status: 200, expected: { intent: 'NAMED_OTC', risk_tier: 'ALLOW', confidence: 1, layers_triggered: [] } },
  { path: '/api/drugs/search?q=panadol', method: 'GET', handler: drugs.GET, status: 200, expected: { results: [], count: 0, query: 'panadol', filters: { category: null, hasLocation: false, inStockOnly: false, location: null } } },
  { path: '/api/reservations', method: 'GET', handler: reservations.GET, status: 200, expected: { reservations: [] } },
  { path: '/api/reservations', method: 'POST', handler: reservations.POST, body: { inventory_id: INVENTORY, quantity: 1 }, status: 201, expected: { reservation: { id: INVENTORY } } },
  { path: '/api/reservations', method: 'PATCH', handler: reservations.PATCH, body: { id: INVENTORY }, status: 200, expected: { reservation: { id: INVENTORY } } },
  { path: '/api/reservations/prescription', method: 'GET', handler: prescription.GET, status: 200, expected: { submissions: [] } },
  { path: '/api/notifications/preferences', method: 'GET', handler: preferences.GET, status: 200, expected: { preferences: prefs } },
  { path: '/api/notifications/preferences', method: 'PUT', handler: preferences.PUT, body: prefs, status: 200, expected: { preferences: prefs } },
  { path: '/api/privacy/delete-my-data', method: 'DELETE', handler: privacy.DELETE, status: 200, expected: { success: true, private_files_removed: 0, private_files_queued: false } },
  { path: '/auth/native/complete', method: 'POST', handler: completion.POST, body: { next: '/history' }, status: 200, expected: { destination: '/history' } },
]

describe('native transport through patient route handlers', () => {
  beforeEach(() => {
    role = 'patient'
    persistedRole = 'patient'
    storedFile = null
    authCalls = []
    roleSyncFails = false
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-anon-key')
    vi.stubEnv('NATIVE_ALLOWED_ORIGINS', `${ORIGIN},https://localhost`)
    mocks.cookieClient.mockReset()
    mocks.getAdminClient.mockReturnValue(adminClient())
    mocks.sendReservationNotifications.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      if (url.pathname.startsWith('/auth/v1/')) {
        authCalls.push({ method: req.method, authorization: req.headers.get('authorization'), apikey: req.headers.get('apikey'), body: req.method === 'PUT' ? await req.text() : '' })
        if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) return Response.json({ msg: 'invalid' }, { status: 401 })
        if (req.method === 'PUT' && roleSyncFails) return Response.json({ msg: 'update rejected' }, { status: 400 })
        return Response.json(authUser())
      }
      const name = url.pathname.split('/').at(-1)
      if (url.pathname.includes('/rest/v1/rpc/')) {
        if (name === 'match_catalogue_product') return Response.json([])
        if (name === 'create_reservation' || name === 'cancel_reservation') return Response.json({ id: INVENTORY })
        if (name === 'set_authenticated_notification_preferences') return Response.json(prefs)
        if (name === 'delete_my_data') return Response.json({ success: true })
        return Response.json([])
      }
      if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') return new Response(null, { status: 201 })
      if (name === 'users') return Response.json(persistedRole ? { role: persistedRole } : null)
      if (name === 'notification_preferences') return Response.json(prefs)
      return Response.json([])
    }))
    // A cookie-authenticated client uses the same authenticated identity, with
    // its session supplied by the cookie helper instead of the incoming bearer.
    const cookie = createSupabaseClient(SUPABASE, 'public-test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
    })
    mocks.cookieClient.mockResolvedValue(cookie)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it.each(cases)('$method $path preserves the cookie result and accepts a patient bearer', async testCase => {
    const cookieResponse = await testCase.handler(input(testCase.path, testCase.method, false, undefined, testCase.body))
    const cookieBody = await cookieResponse.text()
    expect(cookieResponse.status).toBe(testCase.status)
    expect(JSON.parse(cookieBody)).toEqual(testCase.expected)

    const bearerResponse = await testCase.handler(input(testCase.path, testCase.method, true, ORIGIN, testCase.body))
    expect(bearerResponse.status).toBe(cookieResponse.status)
    expect(await bearerResponse.text()).toBe(cookieBody)
    expect(bearerResponse.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(bearerResponse.headers.get('access-control-allow-credentials')).toBeNull()
  })

  // Set I1_BASELINE_ROOT to a read-only snapshot made before the transport
  // changes to compare each actual old handler against the new cookie path.
  it.skipIf(!process.env.I1_BASELINE_ROOT).each(cases)(
    '$method $path matches the pre-change cookie status and bytes', async testCase => {
      const pathname = testCase.path.split('?')[0]
      const file = `${process.env.I1_BASELINE_ROOT}/app${pathname}/route.ts`
      const old = await import(/* @vite-ignore */ file)
      const baseline = await old[testCase.method](input(testCase.path, testCase.method, false, undefined, testCase.body))
      const current = await testCase.handler(input(testCase.path, testCase.method, false, undefined, testCase.body))
      expect(current.status).toBe(baseline.status)
      expect([...current.headers.entries()]).toEqual([...baseline.headers.entries()])
      expect(await current.text()).toBe(await baseline.text())
    },
  )

  it.each(cases)('$method $path refuses disallowed and missing origins, including with cookies', async testCase => {
    for (const origin of ['https://evil.example', undefined]) {
      const req = input(testCase.path, testCase.method, true, origin, testCase.body)
      req.headers.set('Cookie', 'sb-fake-auth-token=some-cookie')
      const response = await testCase.handler(req)
      expect([401, 403]).toContain(response.status)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it.each(paths)('%s supplies native-only preflight', async (path, mod) => {
    const method = path === '/api/privacy/delete-my-data' ? 'DELETE'
      : path === '/api/notifications/preferences' ? 'PUT'
        : path === '/api/drugs/search' ? 'GET' : 'POST'
    const response = await mod.OPTIONS(new NextRequest(`https://www.askstocmed.com${path}`, {
      method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' },
    }))
    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(300)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('advertises the requested drug-search POST while preserving its existing 405 route', async () => {
    const response = await drugs.OPTIONS(new NextRequest('https://www.askstocmed.com/api/drugs/search', {
      method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('allow')).not.toContain('POST')
  })

  it('keeps the ordinary cookie drug-search POST byte-identical to Next\'s automatic 405', async () => {
    const baseline = new Response(null, { status: 405 })
    const current = await drugs.POST(input('/api/drugs/search', 'POST', false))
    expect(current.status).toBe(baseline.status)
    expect([...current.headers.entries()]).toEqual([...baseline.headers.entries()])
    expect(await current.text()).toBe(await baseline.text())
    expect(authCalls).toHaveLength(0)
  })

  it('validates a native bearer before returning the uncached drug-search 405', async () => {
    const current = await drugs.POST(input('/api/drugs/search', 'POST', true, ORIGIN))
    expect(current.status).toBe(405)
    expect(await current.text()).toBe('')
    expect(current.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(current.headers.get('access-control-allow-origin')).not.toContain(',')
    expect(current.headers.get('access-control-allow-credentials')).toBeNull()
    expect(current.headers.get('cache-control')).toBe('no-store')
    expect(authCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', authorization: `Bearer ${TOKEN}`, apikey: 'public-test-anon-key' }),
    ]))
  })

  it('rejects invalid or untrusted bearers before returning a drug-search 405', async () => {
    const invalid = input('/api/drugs/search', 'POST', true, ORIGIN)
    invalid.headers.set('Authorization', 'Bearer invalid.token.value')
    const invalidResponse = await drugs.POST(invalid)
    expect(invalidResponse.status).toBe(401)
    expect(invalidResponse.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    for (const origin of ['https://evil.example', undefined]) {
      const forbidden = await drugs.POST(input('/api/drugs/search', 'POST', true, origin))
      expect(forbidden.status).toBe(403)
      expect(forbidden.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('keeps the browser OPTIONS Allow header for drug search', async () => {
    const response = await drugs.OPTIONS(input('/api/drugs/search', 'OPTIONS', false))
    expect(response.status).toBe(204)
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('does not add native CORS headers to an automatic HEAD response', async () => {
    const response = await searches.GET(input('/api/searches', 'HEAD', false, ORIGIN))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('retains the cookie client for HEAD even when a bearer header is present', async () => {
    const response = await searches.GET(input('/api/searches', 'HEAD', true, ORIGIN))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(mocks.cookieClient).toHaveBeenCalledTimes(1)
  })

  it('preserves bearer response streaming and CORS for the assistant', async () => {
    const body = { conversation: [{ role: 'user', content: 'hello' }], query: '' }
    const cookie = await assistant.POST(input('/api/chat/assistant', 'POST', false, undefined, body))
    const cookieStream = await cookie.text()
    const response = await assistant.POST(input('/api/chat/assistant', 'POST', true, ORIGIN, {
      conversation: [{ role: 'user', content: 'hello' }], query: '',
    }))
    expect(response.status).toBe(cookie.status)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value) }
    expect(text).toBe(cookieStream)
    expect(text).toContain('"type":"delta"')
    expect(text).toContain('"type":"done"')
  })

  it('delivers assistant SSE chunks before a delayed provider stream completes', async () => {
    const { getAnthropicClient } = await import('@/lib/anthropic')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'first' } }
        await gate
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' second' } }
      },
    }
    vi.mocked(getAnthropicClient).mockReturnValueOnce({ messages: { stream: () => stream } } as any)
    const response = await assistant.POST(input('/api/chat/assistant', 'POST', true, ORIGIN, {
      conversation: [{ role: 'user', content: 'panadol' }],
      query: 'panadol',
      pharmacies: [{ name: 'Panadol', pharmacy_id: PHARMACY }],
    }))
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    try {
      const lead = decoder.decode((await reader.read()).value)
      const first = decoder.decode((await reader.read()).value)
      expect(lead).toContain('"type":"delta"')
      expect(first).toContain('first')
      let resolved = false
      const next = reader.read().then(chunk => { resolved = true; return chunk })
      await Promise.resolve()
      expect(resolved).toBe(false)
      release()
      expect(decoder.decode((await next).value)).toContain(' second')
      expect(decoder.decode((await reader.read()).value)).toContain('"type":"done"')
      expect((await reader.read()).done).toBe(true)
    } finally {
      release()
    }
  })

  it.skipIf(!process.env.I1_BASELINE_ROOT)('matches the pre-change assistant cookie stream byte for byte', async () => {
    const file = `${process.env.I1_BASELINE_ROOT}/app/api/chat/assistant/route.ts`
    const old = await import(/* @vite-ignore */ file)
    const body = { conversation: [{ role: 'user', content: 'hello' }], query: '' }
    const baseline = await old.POST(input('/api/chat/assistant', 'POST', false, undefined, body))
    const current = await assistant.POST(input('/api/chat/assistant', 'POST', false, undefined, body))
    expect(current.status).toBe(baseline.status)
    expect([...current.headers.entries()]).toEqual([...baseline.headers.entries()])
    expect(await current.text()).toBe(await baseline.text())
  })

  it('parses and stores a valid multipart prescription with bearer auth', async () => {
    const form = () => {
      const data = new FormData()
      data.set('inventory_id', INVENTORY)
      data.set('quantity', '1')
      data.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'rx.pdf', { type: 'application/pdf' }))
      return data
    }
    const cookie = await prescription.POST(input('/api/reservations/prescription', 'POST', false, undefined, form()))
    const cookieBody = await cookie.text()
    expect(cookie.status).toBe(201)
    const response = await prescription.POST(input('/api/reservations/prescription', 'POST', true, ORIGIN, form()))
    expect(response.status).toBe(cookie.status)
    expect(await response.text()).toBe(cookieBody)
    expect(JSON.parse(cookieBody)).toEqual({ submission: { id: INVENTORY, status: 'submitted' } })
    expect(storedFile).not.toBeNull()
    expect(storedFile!.path).toMatch(new RegExp(`^${USER}/.*\\.pdf$`))
    expect([...storedFile!.bytes]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
  })

  it.skipIf(!process.env.I1_BASELINE_ROOT)('matches the pre-change multipart cookie status and bytes', async () => {
    const file = `${process.env.I1_BASELINE_ROOT}/app/api/reservations/prescription/route.ts`
    const old = await import(/* @vite-ignore */ file)
    const form = () => {
      const data = new FormData()
      data.set('inventory_id', INVENTORY)
      data.set('quantity', '1')
      data.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'rx.pdf', { type: 'application/pdf' }))
      return data
    }
    const baseline = await old.POST(input('/api/reservations/prescription', 'POST', false, undefined, form()))
    const current = await prescription.POST(input('/api/reservations/prescription', 'POST', false, undefined, form()))
    expect(current.status).toBe(baseline.status)
    expect([...current.headers.entries()]).toEqual([...baseline.headers.entries()])
    expect(await current.text()).toBe(await baseline.text())
  })

  it('preserves the role-less redirect on APIs while allowing native completion', async () => {
    role = undefined
    persistedRole = undefined
    const denied = await searches.GET(input('/api/searches', 'GET', true, ORIGIN))
    expect([302, 303, 307, 308, 401, 403]).toContain(denied.status)
    const complete = await completion.POST(input('/auth/native/complete', 'POST', true, ORIGIN, {}))
    expect(complete.status).toBe(200)
    expect(await complete.json()).toEqual({ destination: '/complete-profile' })
  })

  it.each(cases.filter(testCase => testCase.path !== '/auth/native/complete'))(
    '$method $path rejects a role-less bearer as cookie middleware does', async testCase => {
      role = undefined
      persistedRole = undefined
      const response = await testCase.handler(input(testCase.path, testCase.method, true, ORIGIN, testCase.body))
      expect([302, 303, 307, 308, 401, 403]).toContain(response.status)
      if (response.status >= 300 && response.status < 400) {
        expect(response.headers.get('location')).toContain('/complete-profile')
      }
    },
  )

  it.each([
    ['/api/chat/assistant', assistant.POST, { conversation: [{ role: 'user', content: 'hello' }], query: '' }],
    ['/api/reservations/prescription', prescription.POST, new FormData()],
  ] as const)('%s applies the role-less middleware rule before the handler', async (path, handler, body) => {
    role = undefined
    persistedRole = undefined
    const response = await handler(input(path, 'POST', true, ORIGIN, body))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/complete-profile')
  })

  it.each(cases)('$method $path preserves existing pharmacy-role behavior', async testCase => {
    role = 'pharmacy'
    persistedRole = 'pharmacy'
    const cookie = await testCase.handler(input(testCase.path, testCase.method, false, undefined, testCase.body))
    const bearer = await testCase.handler(input(testCase.path, testCase.method, true, ORIGIN, testCase.body))
    expect(bearer.status).toBe(cookie.status)
    expect(await bearer.text()).toBe(await cookie.text())
  })

  it.each([
    ['/api/chat/assistant', assistant.POST, { conversation: [{ role: 'user', content: 'hello' }], query: '' }],
    ['/api/reservations/prescription', prescription.POST, new FormData()],
  ] as const)('%s rejects a bearer from an unlisted or missing origin', async (path, handler, body) => {
    for (const origin of ['https://evil.example', undefined]) {
      const response = await handler(input(path, 'POST', true, origin, body))
      expect([401, 403]).toContain(response.status)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('keeps pharmacy identities out of the patient dashboard at native completion', async () => {
    role = 'pharmacy'
    persistedRole = 'pharmacy'
    const response = await completion.POST(input('/auth/native/complete', 'POST', true, ORIGIN, { next: '/dashboard' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ destination: '/' })
  })

  it('synchronizes stale metadata through Auth using the validated bearer, without an admin key', async () => {
    role = 'pharmacy'
    persistedRole = 'patient'
    const response = await completion.POST(input('/auth/native/complete', 'POST', true, ORIGIN, {}))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ destination: '/dashboard' })
    const update = authCalls.find(call => call.method === 'PUT')
    expect(update).toMatchObject({ authorization: `Bearer ${TOKEN}`, apikey: 'public-test-anon-key' })
    expect(JSON.parse(update!.body)).toEqual({ data: { role: 'patient' } })
  })

  it('revokes the bearer session when native metadata synchronization fails', async () => {
    role = 'pharmacy'
    persistedRole = 'patient'
    roleSyncFails = true
    const response = await completion.POST(input('/auth/native/complete', 'POST', true, ORIGIN, {}))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'oauth_role_sync_failed' })
    expect(authCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', authorization: `Bearer ${TOKEN}`, apikey: 'public-test-anon-key' }),
    ]))
  })
})
