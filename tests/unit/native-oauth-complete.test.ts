import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { POST } from '@/app/auth/native/complete/route'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function request(next = '/dashboard', native = true) {
  return new Request('https://askstocmed.com/auth/native/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': native ? 'Mozilla/5.0 StocMedApp/1.0' : 'Mozilla/5.0',
    },
    body: JSON.stringify({ next }),
  })
}

function client(profileRole?: 'patient' | 'pharmacy', metadataRole?: string) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: profileRole ? { role: profileRole } : null,
    error: null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            user_metadata: metadataRole ? { role: metadataRole } : {},
          },
        },
        error: null,
      }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from,
  }
}

describe('native OAuth server completion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the requested patient destination after checking public.users', async () => {
    const supabase = client('patient', 'patient')
    mocks.createClient.mockResolvedValue(supabase)

    const response = await POST(request('/history'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ destination: '/history' })
    expect(supabase.from).toHaveBeenCalledWith('users')
  })

  it('syncs stale metadata from the authoritative profile', async () => {
    const supabase = client('patient', 'pharmacy')
    mocks.createClient.mockResolvedValue(supabase)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { role: 'patient' } })
  })

  it('keeps pharmacy accounts out of the patient dashboard', async () => {
    const supabase = client('pharmacy', 'pharmacy')
    mocks.createClient.mockResolvedValue(supabase)

    const response = await POST(request('/dashboard'))

    expect(await response.json()).toEqual({ destination: '/' })
  })

  it('routes a new Google identity to patient profile completion', async () => {
    const supabase = client()
    mocks.createClient.mockResolvedValue(supabase)

    const response = await POST(request())

    expect(await response.json()).toEqual({ destination: '/complete-profile' })
  })

  it('rejects non-native callers before reading a session', async () => {
    const response = await POST(request('/dashboard', false))

    expect(response.status).toBe(404)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
