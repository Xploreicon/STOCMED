import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNativeOAuthCallback } from '@/lib/auth/native-oauth'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: mocks.getAdminClient }))

import { GET } from '@/app/(auth)/auth-callback/route'

const FLOW = 'a1e7b879-8e3f-4d2f-9220-9b9bb0773d2c'

function session(role?: 'patient' | 'pharmacy') {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    expires_at: 1_800_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      app_metadata: {},
      user_metadata: role ? { role } : {},
      aud: 'authenticated',
      created_at: '2026-08-22T00:00:00.000Z',
    },
  }
}

function callbackClient(persistedRole?: 'patient' | 'pharmacy') {
  const authSession = session(persistedRole)
  const maybeSingle = vi.fn().mockResolvedValue({
    data: persistedRole ? { role: persistedRole } : null,
    error: null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))

  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: authSession },
        error: null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: authSession }, error: null }),
    },
    from,
  }
}

function callbackUrl(next?: string) {
  const url = new URL('https://askstocmed.com/auth-callback')
  url.searchParams.set('code', 'oauth-code')
  url.searchParams.set('native', '1')
  url.searchParams.set('flow', FLOW)
  if (next) url.searchParams.set('next', next)
  return url
}

describe('native OAuth server callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminClient.mockReturnValue(null)
  })

  it('queries the persisted patient role before returning a native session', async () => {
    const client = callbackClient('patient')
    mocks.createClient.mockResolvedValue(client)

    const response = await GET(new Request(callbackUrl('/history').toString()))
    const callback = parseNativeOAuthCallback(response.headers.get('location') || '')

    expect(response.status).toBe(303)
    expect(client.from).toHaveBeenCalledWith('users')
    expect(callback).toMatchObject({
      kind: 'session',
      flow: FLOW,
      destination: '/history',
    })
  })

  it('returns an existing pharmacy to the terminal native landing page', async () => {
    const client = callbackClient('pharmacy')
    mocks.createClient.mockResolvedValue(client)

    const response = await GET(new Request(callbackUrl('/pharmacy/dashboard').toString()))
    const callback = parseNativeOAuthCallback(response.headers.get('location') || '')

    expect(callback).toMatchObject({ kind: 'session', destination: '/' })
  })

  it('routes a new Google identity to server-enforced patient onboarding', async () => {
    const client = callbackClient()
    mocks.createClient.mockResolvedValue(client)

    const response = await GET(new Request(callbackUrl().toString()))
    const callback = parseNativeOAuthCallback(response.headers.get('location') || '')

    expect(callback).toMatchObject({ kind: 'session', destination: '/complete-profile' })
  })
})
