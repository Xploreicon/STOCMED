import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  const path = request.nextUrl.pathname

  // Protected patient routes
  const patientRoutes = ['/dashboard', '/chat', '/history']
  const isPatientRoute = patientRoutes.some(route => path.startsWith(route))

  // Protected pharmacy routes (including insights)
  const isPharmacyRoute = path.startsWith('/pharmacy') || path === '/insights'

  // Auth routes
  const authRoutes = ['/login', '/signup']
  const isAuthRoute = authRoutes.some(route => path.startsWith(route))

  // Get user role if authenticated
  const role = user?.user_metadata?.role || 'patient'

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
