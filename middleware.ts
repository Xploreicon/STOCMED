import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  const path = request.nextUrl.pathname

  // Protected patient routes
  const patientRoutes = ['/dashboard', '/chat', '/history']
  const isPatientRoute = patientRoutes.some(route => path.startsWith(route))

  // Protected pharmacy routes
  const isPharmacyRoute = path.startsWith('/pharmacy')

  // Auth routes
  const authRoutes = ['/login', '/signup']
  const isAuthRoute = authRoutes.some(route => path.startsWith(route))

  // Redirect authenticated users away from auth pages
  if (user && isAuthRoute) {
    // Get user metadata to determine role
    const userMetadata = user.user_metadata
    const role = userMetadata?.role || 'patient'

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
