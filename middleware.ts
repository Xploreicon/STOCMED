import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { getNativeRestrictedRedirect, isStocMedAppUserAgent } from '@/lib/native-app'
import { handleNativePatientRequest } from '@/lib/native-patient-middleware'
import { shouldCompleteOAuthProfile } from '@/lib/auth/google-oauth-policy'

export async function middleware(request: NextRequest) {
  const session = await updateSession(request)
  const { supabaseResponse, user, supabase, getSupabaseResponse } = session

  const path = request.nextUrl.pathname
  const isNativeApp = isStocMedAppUserAgent(request.headers.get('user-agent'))
  const isNativeOnlyRoute = path.startsWith('/native/')
  const nativeRestrictedRedirect = getNativeRestrictedRedirect(path, isNativeApp)

  if (nativeRestrictedRedirect) {
    return NextResponse.redirect(new URL(nativeRestrictedRedirect, request.url))
  }

  if (isNativeOnlyRoute) {
    const publicPath = path === '/native/complete-profile' ? '/complete-profile' : '/signup'
    return NextResponse.redirect(new URL(publicPath, request.url))
  }

  // The broadcast console is a write-capable admin surface. Keep its page
  // boundary as strict as its APIs: authenticated non-admins receive 403,
  // while unauthenticated requests continue to the layout's login redirect.
  if (user && (path === '/admin/broadcast' || path.startsWith('/admin/broadcast/'))) {
    const { data: broadcastViewer, error: broadcastViewerError } = await (supabase as any)
      .from('users')
      .select('is_admin,admin_authorized_at,admin_authorization_basis')
      .eq('user_id', user.id)
      .maybeSingle()
    const mayBroadcast = Boolean(
      !broadcastViewerError
      && broadcastViewer?.is_admin
      && broadcastViewer?.admin_authorized_at
      && broadcastViewer?.admin_authorization_basis?.trim(),
    )
    if (!mayBroadcast) {
      return new NextResponse('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store, private' },
      })
    }
  }

  if (isNativeApp) {
    const nativeResponse = await handleNativePatientRequest(path, {
      request,
      user,
      supabase,
      getSupabaseResponse,
    })
    if (nativeResponse) return nativeResponse
  }

  // Protected patient routes
  const patientRoutes = ['/dashboard', '/chat', '/history']
  const isPatientRoute = patientRoutes.some(route => path.startsWith(route))

  // Protected pharmacy routes (including insights)
  const isPharmacyRoute = path.startsWith('/pharmacy') || path === '/insights'

  // Auth routes
  const authRoutes = ['/login', '/signup']
  const isAuthRoute = authRoutes.some(route => path.startsWith(route))

  // Get user role if authenticated
  const role = user?.user_metadata?.role

  // OAuth identities are deliberately role-less until the authoritative
  // onboarding transaction completes.
  if (
    user
    && shouldCompleteOAuthProfile(role, path)
  ) {
    return NextResponse.redirect(new URL('/complete-profile', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (user && isAuthRoute) {
    const redirectUrl = new URL(
      role === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard',
      request.url
    )
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect unauthenticated users to login
  if (!user && (isPatientRoute || isPharmacyRoute)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', path)
    return NextResponse.redirect(loginUrl)
  }

  // Enforce role separation for authenticated users
  if (user) {
    if (isPharmacyRoute && role !== 'pharmacy') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    if (isPatientRoute && role !== 'patient') {
      return NextResponse.redirect(new URL('/pharmacy/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
