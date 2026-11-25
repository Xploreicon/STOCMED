import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
import { nativeFetch, patientApiUrl } from '@/lib/api/client'
import { subscribeAuthRevalidation } from '@/lib/auth/revalidation'
import { consumeAssistantResponse } from '@/lib/chat-stream'

beforeEach(() => { auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'current-user-token' } }, error: null }); vi.stubEnv('NEXT_PUBLIC_STOCMED_API_ORIGIN', 'https://www.askstocmed.com') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('patient bearer boundary', () => {
  it('uses a fresh bearer for each absolute request and overrides cookie settings', async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'first-token' } } }).mockResolvedValueOnce({ data: { session: { access_token: 'second-token' } } })
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    await nativeFetch('/api/searches', { credentials: 'include', cache: 'force-cache', redirect: 'follow', headers: { Cookie: 'must-not-travel', Origin: 'https://evil.example', Authorization: 'Bearer stale' } })
    await nativeFetch('/api/searches')
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://www.askstocmed.com/api/searches', 'https://www.askstocmed.com/api/searches'])
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'manual' })
    const headers = fetcher.mock.calls.map(call => call[1].headers as Headers)
    expect(headers[0].get('authorization')).toBe('Bearer first-token')
    expect(headers[1].get('authorization')).toBe('Bearer second-token')
    expect(headers[0].has('cookie')).toBe(false); expect(headers[0].has('origin')).toBe(false)
  })
  it.each(['https://evil.example/api/searches', '//evil.example/api/searches', '/api/searches/one', '/api/pharmacy/drugs', '/api/searches#fragment', '/api\\searches'])('rejects unsupported URL %s before Auth/fetch', path => {
    expect(() => patientApiUrl(path)).toThrow(); expect(auth.getSession).not.toHaveBeenCalled()
  })
  it('allows only the real drug-search GET and canonical configured origin', () => {
    expect(patientApiUrl('/api/drugs/search?q=Panadol&lat=6').href).toBe('https://www.askstocmed.com/api/drugs/search?q=Panadol&lat=6')
    expect(() => patientApiUrl('/api/drugs/search', 'POST')).toThrow()
    vi.stubEnv('NEXT_PUBLIC_STOCMED_API_ORIGIN', 'https://askstocmed.com')
    expect(() => patientApiUrl('/api/searches')).toThrow()
  })
  it('requests observable Auth revalidation without a network request when the session is absent', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const revalidate = vi.fn(); const stop = subscribeAuthRevalidation(revalidate)
    try { await expect(nativeFetch('/api/searches')).rejects.toMatchObject({ code: 'session_missing', revalidate: true }); expect(revalidate).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled() } finally { stop() }
  })
  it.each([401, 403, 409, 429, 503])('preserves JSON HTTP%s and never silently replays a mutation', async status => {
    const response = Response.json({ error: 'endpoint-specific error' }, { status })
    const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetcher)
    const revalidate = vi.fn(); const stop = subscribeAuthRevalidation(revalidate)
    try {
      expect(await nativeFetch('/api/reservations', { method: 'POST', body: '{}' })).toBe(response)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(revalidate).toHaveBeenCalledTimes(status === 401 || status === 403 ? 1 : 0)
    } finally { stop() }
  })
  it.each(['text/plain', 'text/html', 'application/octet-stream'])('revalidates an unexpected %s outcome', async contentType => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unexpected', { headers: { 'Content-Type': contentType } })))
    const revalidate = vi.fn(); const stop = subscribeAuthRevalidation(revalidate)
    try { await expect(nativeFetch('/api/searches')).rejects.toMatchObject({ code: 'profile_revalidation_required' }); expect(revalidate).toHaveBeenCalledOnce() } finally { stop() }
  })
  it('revalidates opaque redirects without reading a hidden Location or following HTML', async () => {
    const response = new Response(); Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
    const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetcher)
    const revalidate = vi.fn(); const stop = subscribeAuthRevalidation(revalidate)
    try { await expect(nativeFetch('/api/searches')).rejects.toMatchObject({ revalidate: true }); expect(revalidate).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce() } finally { stop() }
  })
  it('lets fetch supply the multipart boundary even if a caller supplied Content-Type', async () => {
    const form = new FormData(); form.set('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'fixture.pdf')
    const fetcher = vi.fn().mockResolvedValue(Response.json({ submission: {} }, { status: 201 })); vi.stubGlobal('fetch', fetcher)
    await nativeFetch('/api/reservations/prescription', { method: 'POST', body: form, headers: { 'Content-Type': 'multipart/form-data' } })
    expect(fetcher.mock.calls[0][1].body).toBe(form); expect(fetcher.mock.calls[0][1].headers.has('content-type')).toBe(false)
  })
  it('delivers the first SSE delta before the provider finishes and accepts the JSON fallback', async () => {
    let finish!: () => void
    const paused = new Promise<void>(resolve => { finish = resolve })
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ async start(controller) { controller.enqueue(encoder.encode('data: {"type":"delta","text":"first"}\n\n')); await paused; controller.enqueue(encoder.encode('data: {"type":"done"}\n\n')); controller.close() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })))
    const response = await nativeFetch('/api/chat/assistant', { method: 'POST' })
    const delta = vi.fn(); const consuming = consumeAssistantResponse(response, delta)
    await vi.waitFor(() => expect(delta).toHaveBeenCalledWith('first'))
    finish(); expect(await consuming).toBe('first')
    expect(await consumeAssistantResponse(Response.json({ message: 'fallback' }), vi.fn())).toBe('fallback')
  })
  it('preserves an abort signal and AbortError without replay', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')); vi.stubGlobal('fetch', fetcher)
    await expect(nativeFetch('/api/chat/assistant', { method: 'POST', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal); expect(fetcher).toHaveBeenCalledOnce()
  })
  it('refuses a stale owner before sending an old search with a new account token', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'new-account-token', user: { id: 'B' } } } })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(nativeFetch('/api/searches', { method: 'POST', body: '{"query":"old-account-search"}', expectedUserId: 'A' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not pass the owner contract to fetch and stops pre-aborted work before Auth', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'account-token', user: { id: 'A' } } } })
    const fetcher = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal('fetch', fetcher)
    await nativeFetch('/api/searches', { expectedUserId: 'A' })
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('expectedUserId')
    const controller = new AbortController(); controller.abort(); auth.getSession.mockClear(); fetcher.mockClear()
    await expect(nativeFetch('/api/searches', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(auth.getSession).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })
})
