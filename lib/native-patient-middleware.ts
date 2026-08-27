import type { User } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import type { updateSession } from '@/lib/supabase/middleware'
import {
  isPatientLocation,
  renderNativeCompleteProfile,
  renderNativeSignup,
} from '@/lib/native-patient-pages'

type NativePatientContext = {
  request: NextRequest
  user: User | null
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase']
  getSupabaseResponse: () => NextResponse
}

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://ingest.sentry.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://auth.askstocmed.com wss://auth.askstocmed.com https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://ingest.sentry.io; worker-src 'self' blob:; frame-ancestors 'none';",
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function withSessionCookies(response: NextResponse, getSupabaseResponse: () => NextResponse) {
  getSupabaseResponse().cookies.getAll().forEach(cookie => response.cookies.set(cookie))
  return response
}

function html(
  body: string,
  getSupabaseResponse: () => NextResponse,
  status = 200,
) {
  return withSessionCookies(
    new NextResponse(body, { status, headers: SECURITY_HEADERS }),
    getSupabaseResponse,
  )
}

function redirect(
  destination: string,
  request: NextRequest,
  getSupabaseResponse: () => NextResponse,
  status: 307 | 303 = 307,
) {
  return withSessionCookies(
    NextResponse.redirect(new URL(destination, request.url), status),
    getSupabaseResponse,
  )
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!origin || !host) return false
  try {
    const originUrl = new URL(origin)
    const forwardedProtocol = request.headers.get('x-forwarded-proto')
    const requestProtocol = forwardedProtocol ? `${forwardedProtocol}:` : originUrl.protocol
    return originUrl.host === host && originUrl.protocol === requestProtocol
  } catch {
    return false
  }
}

async function signup(context: NativePatientContext): Promise<NextResponse> {
  const { request, user, supabase, getSupabaseResponse } = context
  if (user) {
    const role = user.user_metadata?.role
    return redirect(
      role === 'patient' ? '/dashboard' : role === 'pharmacy' ? '/' : '/complete-profile',
      request,
      getSupabaseResponse,
    )
  }
  if (request.method === 'GET') {
    return html(renderNativeSignup(), getSupabaseResponse)
  }
  if (request.method !== 'POST') {
    return html(renderNativeSignup({ error: 'This request is not supported.' }), getSupabaseResponse, 405)
  }
  if (!isSameOrigin(request)) {
    return html(
      renderNativeSignup({ error: 'Please retry signup from the StocMed app.' }),
      getSupabaseResponse,
      403,
    )
  }

  const formData = await request.formData()
  const fullName = String(formData.get('full_name') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const phone = String(formData.get('phone') || '').replace(/\s/g, '')
  const location = String(formData.get('location') || '')
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirm_password') || '')
  const rerender = (error: string, status = 400) => html(renderNativeSignup({
    error,
    fullName,
    email,
    phone,
    location,
  }), getSupabaseResponse, status)

  if (!fullName) return rerender('Full name is required.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return rerender('Enter a valid email address.')
  if (!/^\+234\d{10}$/.test(phone)) return rerender('Phone must be in format +234XXXXXXXXXX.')
  if (!isPatientLocation(location)) return rerender('Choose your location.')
  if (password.length < 8) return rerender('Password must be at least 8 characters.')
  if (password !== confirmPassword) return rerender('Passwords do not match.')
  if (formData.get('accepted_terms') !== 'on') {
    return rerender('Confirm the terms and privacy notice before continuing.')
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: 'patient',
        full_name: fullName,
        phone,
        location,
        pharmacy_profile: null,
      },
    },
  })
  if (authError) return rerender(authError.message)
  if (!authData.user) return rerender('Failed to create account.')

  if (authData.session) {
    const { data: persistedProfile, error: profileError } = await (supabase.from('users') as any)
      .select('user_id, role, location')
      .eq('user_id', authData.user.id)
      .single()
    if (
      profileError
      || !persistedProfile
      || persistedProfile.role !== 'patient'
      || persistedProfile.location !== location
    ) {
      await supabase.auth.signOut()
      return rerender('Your account profile and location could not be saved. No session was started; please retry signup.')
    }
  }

  return redirect(
    authData.session ? '/dashboard' : '/login?verifyEmail=1',
    request,
    getSupabaseResponse,
    303,
  )
}

async function completeProfile(context: NativePatientContext): Promise<NextResponse> {
  const { request, user, supabase, getSupabaseResponse } = context
  if (!user) return redirect('/login', request, getSupabaseResponse)

  const { data: profile } = await (supabase.from('users') as any)
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (profile?.role === 'patient') return redirect('/dashboard', request, getSupabaseResponse)
  if (profile?.role === 'pharmacy') return redirect('/', request, getSupabaseResponse)

  const fullName = user.user_metadata?.full_name || user.user_metadata?.name || ''
  if (request.method === 'GET') {
    return html(renderNativeCompleteProfile({ fullName }), getSupabaseResponse)
  }
  if (request.method !== 'POST') {
    return html(
      renderNativeCompleteProfile({ fullName, error: 'This request is not supported.' }),
      getSupabaseResponse,
      405,
    )
  }
  if (!isSameOrigin(request)) {
    return html(
      renderNativeCompleteProfile({ fullName, error: 'Please retry from the StocMed app.' }),
      getSupabaseResponse,
      403,
    )
  }

  const formData = await request.formData()
  const submittedName = String(formData.get('full_name') || '').trim()
  const phone = String(formData.get('phone') || '').replace(/\s/g, '')
  const location = String(formData.get('location') || '')
  const rerender = (error: string) => html(
    renderNativeCompleteProfile({ fullName: submittedName, error }),
    getSupabaseResponse,
    400,
  )

  if (!submittedName) return rerender('Enter your full name.')
  if (!/^\+234[789][01]\d{8}$/.test(phone)) {
    return rerender('Enter a valid Nigerian mobile number in +234 format.')
  }
  if (!isPatientLocation(location)) return rerender('Choose your location.')
  if (formData.get('accepted_terms') !== 'on') {
    return rerender('Confirm the terms and privacy notice before continuing.')
  }

  const { data, error } = await (supabase.rpc as any)('complete_oauth_profile', {
    p_role: 'patient',
    p_full_name: submittedName,
    p_phone: phone,
    p_location: location,
    p_pharmacy_name: null,
    p_license_number: null,
    p_address: null,
    p_city: null,
    p_state: null,
  })
  if (error || data?.role !== 'patient') {
    return rerender(error?.message || 'Your patient profile could not be completed.')
  }
  await supabase.auth.refreshSession()
  return redirect('/dashboard', request, getSupabaseResponse, 303)
}

export async function handleNativePatientRequest(
  path: string,
  context: NativePatientContext,
): Promise<NextResponse | null> {
  if (path === '/signup') return signup(context)
  if (path === '/complete-profile') return completeProfile(context)
  return null
}
