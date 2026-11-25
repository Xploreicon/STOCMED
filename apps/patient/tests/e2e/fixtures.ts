import { test as base, expect } from '@playwright/test'

const SUPABASE_HOST = 'patient-test.supabase.co'
const API_HOST = 'www.askstocmed.com'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_KEY = 'stocmed:patient:session:v1'
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
export const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USER_ID,
  aud: 'authenticated', role: 'authenticated', iat: 1794000000, exp: 4102444800 })}.local-test-signature`
const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'ade@example.test',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: 'Untrusted Metadata', role: 'patient' },
  created_at: '2026-01-01T00:00:00Z' }
const session = { access_token: accessToken, refresh_token: 'local-test-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: 4102444800, user }
export const preferences = { product_email_opt_in: false, refill_email_opt_in: false,
  reminder_sms_opt_in: false, patient_email_consent: false, patient_sms_consent: false, patient_push_consent: false }
export const historyRow = { id: 'search-1', query_text: 'Paracetamol', product_id: null,
  results_count: 1, location: 'Yaba', searched_at: '2026-11-06T12:00:00Z', timestamp: '2026-11-06T12:00:00Z' }
export const inventory = { id: 'inventory-1', product_id: 'product-1', name: 'Paracetamol',
  brand_name: 'Paracetamol', generic_name: 'Paracetamol', strength: '500mg', dosage_form: 'Tablet',
  price: 1200, quantity_in_stock: 20, low_stock_threshold: 10, reserved_quantity: 0,
  requires_prescription: false, distance_km: 0.8, pharmacies: { pharmacy_name: 'Fixture Pharmacy',
    address: '1 Test Street, Yaba', city: 'Lagos', state: 'Lagos', phone: '+2348000000000',
    operating_hours: '09:00–18:00', is_open_now: true, is_verified: true,
    verification_status: 'full', reservations_enabled: true, digital_prescription_reservations_enabled: true } }

type MockResponse = { status?: number; json?: unknown; body?: string; contentType?: string; waitFor?: Promise<void> }
type MockOptions = { identity: 'none' | 'patient' | 'pharmacy' | 'roleless'; profileError?: boolean;
  location?: string | null; expectedConsoleErrors?: string[] }
type RecordedRequest = { path: string; method: string; headers: Record<string, string>; body: Buffer | null }
type Harness = { responses: Map<string, MockResponse>; requests: RecordedRequest[]; abortedPaths: string[] }

export const test = base.extend<{ app: Harness; mockOptions: MockOptions }>({
  mockOptions: [{ identity: 'none' }, { option: true }],
  app: [async ({ page, context, mockOptions }, use) => {
    const responses = new Map<string, MockResponse>()
    const requests: RecordedRequest[] = []
    const abortedPaths: string[] = []
    const violations: string[] = []
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => {
      if (request.failure()?.errorText.includes('ERR_ABORTED')) abortedPaths.push(new URL(request.url()).pathname)
    })
    await context.addInitScript(({ storedSession, storageKey }) => {
      if (storedSession && !sessionStorage.getItem('stocmed:test:initialized')) {
        localStorage.setItem(storageKey, storedSession)
        sessionStorage.setItem('stocmed:test:initialized', '1')
      }
      // Count attempted registrations as well as asserting no active registration.
      Object.assign(window, { __patientSwAttempts: 0 })
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register = (() => {
          Object.assign(window, { __patientSwAttempts: (window as unknown as { __patientSwAttempts: number }).__patientSwAttempts + 1 })
          return Promise.reject(new Error('A packaged patient app must not register a service worker.'))
        }) as typeof navigator.serviceWorker.register
      }
    }, { storedSession: mockOptions.identity === 'none' ? null : JSON.stringify(session), storageKey: SESSION_KEY })

    // No realtime connection leaves the browser. Reply locally to Phoenix joins/heartbeats.
    await context.routeWebSocket('**/*', socket => {
      if (new URL(socket.url()).hostname !== SUPABASE_HOST) {
        violations.push(`Unexpected WebSocket: ${socket.url()}`); socket.close(); return
      }
      socket.onMessage(message => {
        const parsed = JSON.parse(String(message)) as Record<string, unknown> | unknown[]
        if (Array.isArray(parsed)) {
          const [joinRef, ref, topic] = parsed
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
        } else {
          socket.send(JSON.stringify({ topic: parsed.topic, ref: parsed.ref,
            event: 'phx_reply', payload: { status: 'ok', response: {} } }))
        }
      })
    })
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.hostname === '127.0.0.1') { await route.continue(); return }
      if (url.hostname !== SUPABASE_HOST && url.hostname !== API_HOST) {
        violations.push(`Unexpected host: ${request.method()} ${request.url()}`)
        await route.abort('blockedbyclient'); return
      }
      const cors = { 'access-control-allow-origin': `http://127.0.0.1:${process.env.PATIENT_STATIC_PORT || '4173'}`,
        'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer,range,x-supabase-api-version',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS', 'content-type': 'application/json' }
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      const respond = async (result: MockResponse, extraHeaders: Record<string, string> = {}) => {
        if (result.waitFor) await result.waitFor
        if (request.failure()?.errorText.includes('ERR_ABORTED')) return
        try {
          await route.fulfill({ status: result.status || 200,
            headers: { ...cors, ...extraHeaders, ...(result.contentType ? { 'content-type': result.contentType } : {}) },
            body: result.body ?? JSON.stringify(result.json ?? null) })
        } catch (error) {
          if (!request.failure()?.errorText.includes('ERR_ABORTED')) throw error
        }
      }
      if (url.hostname === SUPABASE_HOST) {
        if (url.pathname === '/auth/v1/recover') { await respond({ json: {} }); return }
        if (url.pathname === '/auth/v1/verify') {
          const body = request.postDataJSON()
          expect(body).toMatchObject({ type: 'recovery', email: user.email })
          if (body.token === '123456') await respond({ json: session })
          else await respond({ status: 403, json: { message: 'Fixture expired code', code: 'otp_expired' } })
          return
        }
        if (url.pathname === '/auth/v1/user') {
          if (request.method() === 'PUT') {
            expect(request.postDataJSON()).toMatchObject({ password: 'Synthetic-new-password' })
            expect((await request.allHeaders()).authorization).toBe(`Bearer ${accessToken}`)
          }
          await respond({ json: user }); return
        }
        if (url.pathname === '/auth/v1/token') { await respond({ json: session }); return }
        if (url.pathname === '/auth/v1/logout') { await route.fulfill({ status: 204, headers: cors }); return }
        if (url.pathname === '/rest/v1/users') {
          if (mockOptions.profileError) { await respond({ status: 503, json: { message: 'Fixture profile unavailable' } }); return }
          await respond({ json: mockOptions.identity === 'roleless' ? null : { user_id: USER_ID,
            role: mockOptions.identity === 'pharmacy' ? 'pharmacy' : 'patient', full_name: 'Ade Patient',
            email: user.email, phone: '+2348000000000', location: mockOptions.location === undefined ? 'Yaba' : mockOptions.location } }); return
        }
        if (url.pathname === '/rest/v1/user_search_history') { await respond({ json: [historyRow] }); return }
        if (url.pathname === '/rest/v1/research_consent') { await respond({ json: { user_id: USER_ID, consented: false, consent_text_version: 'NDPR_V1' } }); return }
        if (url.pathname === '/rest/v1/notifications') { await respond({ json: [] }, { 'content-range': '*/0' }); return }
      } else {
        requests.push({ path: url.pathname, method: request.method(), headers: await request.allHeaders(), body: request.postDataBuffer() })
        const override = responses.get(`${request.method()} ${url.pathname}`)
        if (override) { await respond(override); return }
        const defaults: Record<string, MockResponse> = {
          'GET /api/searches': { json: [historyRow] }, 'POST /api/searches': { json: { success: true } },
          'GET /api/drugs/search': { json: { results: [inventory] } },
          'POST /api/triage': { json: { intent: 'NAMED_OTC', risk_tier: 'ALLOW', confidence: 1 } },
          'POST /api/chat/assistant': { contentType: 'text/event-stream', body: 'data: {"type":"delta","text":"Fixture pharmacy availability."}\n\ndata: {"type":"done"}\n\n' },
          'GET /api/reservations': { json: { reservations: [] } },
          'GET /api/reservations/prescription': { json: { submissions: [] } },
          'GET /api/notifications/preferences': { json: { preferences } },
          'POST /api/reservations': { json: { reservation: { id: 'hold-1', pickup_code: 'TEST123', expires_at: '2099-01-01T12:00:00Z' } } },
          'POST /api/reservations/prescription': { json: { submission: { id: 'rx-1', status: 'pending' } } },
        }
        if (request.method() === 'PUT' && url.pathname === '/api/notifications/preferences') {
          await respond({ json: { preferences: JSON.parse(request.postData() || '{}') } }); return
        }
        const result = defaults[`${request.method()} ${url.pathname}`]
        if (result) { await respond(result); return }
      }
      violations.push(`Unhandled fixture request: ${request.method()} ${request.url()}`)
      await route.abort('blockedbyclient')
    })

    await use({ responses, requests, abortedPaths })
    expect(violations, 'All remote requests must be fulfilled by known local fixtures').toEqual([])
    expect(pageErrors, 'No uncaught page errors').toEqual([])
    const allowedErrors = mockOptions.expectedConsoleErrors || []
    expect(consoleErrors.filter(message => !allowedErrors.some(allowed => message.includes(allowed))),
      'No unexpected console errors').toEqual([])
    if (!page.isClosed()) {
      expect(await page.evaluate(() => (window as unknown as { __patientSwAttempts?: number }).__patientSwAttempts || 0)).toBe(0)
      expect(await page.evaluate(async () => 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0)).toBe(0)
    }
    for (const request of requests) {
      expect(request.headers.authorization).toBe(`Bearer ${accessToken}`)
      expect(request.headers.cookie).toBeUndefined()
    }
  }, { auto: true }],
})

export { expect }
