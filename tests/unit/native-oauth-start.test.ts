import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { GET } from '@/app/auth/native/start/route'

const FLOW = '193bf111-d9f7-49d7-a6d8-a16f9d16dd56'

describe('native OAuth system-browser start', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts Google OAuth with the server callback and flow correlator', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: 'https://auth.askstocmed.com/authorize?provider=google' },
      error: null,
    })
    mocks.createClient.mockResolvedValue({ auth: { signInWithOAuth } })

    const requestUrl = new URL('https://askstocmed.com/auth/native/start')
    requestUrl.searchParams.set('flow', FLOW)
    requestUrl.searchParams.set('next', '/history')
    const response = await GET(new Request(requestUrl))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://auth.askstocmed.com/authorize?provider=google')
    expect(response.headers.get('cache-control')).toBe('no-store')

    const call = signInWithOAuth.mock.calls[0][0]
    const callback = new URL(call.options.redirectTo)
    expect(call.provider).toBe('google')
    expect(callback.pathname).toBe('/auth-callback')
    expect(callback.searchParams.get('native')).toBe('1')
    expect(callback.searchParams.get('flow')).toBe(FLOW)
    expect(callback.searchParams.get('next')).toBe('/history')
  })

  it('rejects an invalid flow before contacting Supabase', async () => {
    const response = await GET(new Request(
      'https://askstocmed.com/auth/native/start?flow=invalid',
    ))

    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
