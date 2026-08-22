import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Session } from '@supabase/supabase-js'
import { decideGoogleOAuthDestination } from '@/lib/auth/google-oauth-policy'
import {
  buildNativeOAuthErrorUrl,
  buildNativeOAuthSessionUrl,
  getSafeNativeOAuthDestination,
  isNativeOAuthFlow,
} from '@/lib/auth/native-oauth'
import { getAdminClient } from '@/lib/supabase/admin'

function nativeRedirect(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function nativeError(flow: string, code: string) {
  return nativeRedirect(buildNativeOAuthErrorUrl(flow, code))
}

function nativeSession(flow: string, session: Session, destination: string) {
  return nativeRedirect(buildNativeOAuthSessionUrl({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    flow,
    destination,
  }))
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')
  const origin = requestUrl.origin
  const requestedNext = requestUrl.searchParams.get('next')
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : null
  const requestedOnboardingRole = requestUrl.searchParams.get('onboardingRole')
  const nativeFlow = requestUrl.searchParams.get('native') === '1'
    ? requestUrl.searchParams.get('flow')
    : null
  const isNativeFlow = isNativeOAuthFlow(nativeFlow)

  if (code) {
    const supabase = await createClient()
    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && session) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password?verified=1`)
      }

      // public.users is authoritative. User metadata is client-writable and
      // must never decide whether an OAuth identity is a pharmacy.
      const { data: dbUser, error: profileError } = await (supabase
        .from('users')
        .select('role')
        .eq('user_id', session.user.id) as any)
        .maybeSingle()
      if (profileError) {
        await supabase.auth.signOut()
        if (isNativeFlow) return nativeError(nativeFlow, 'profile_lookup_failed')
        return NextResponse.redirect(`${origin}/login?error=profile_lookup_failed`)
      }
      const decision = decideGoogleOAuthDestination(
        (dbUser as any)?.role,
        requestedOnboardingRole,
      )

      if (decision.kind !== 'existing_profile') {
        // A crafted pharmacy hint is rejected before any public profile or
        // pharmacy row can be written. The database RPC enforces the same rule.
        if (decision.kind === 'reject_pharmacy_signup') {
          // Supabase creates auth.users during OAuth before returning here.
          // Remove this unprofiled Google-only identity so the same address can
          // complete the required email/password pharmacy signup cleanly.
          const admin = getAdminClient()
          const cleanup = admin
            ? await admin.auth.admin.deleteUser(session.user.id, false)
            : { error: new Error('Admin client unavailable') }
          await supabase.auth.signOut()
          if (cleanup.error) {
            console.error('Could not remove rejected Google pharmacy identity:', cleanup.error.message)
            if (isNativeFlow) return nativeError(nativeFlow, 'oauth_pharmacy_cleanup_failed')
            return NextResponse.redirect(`${origin}/login?error=oauth_pharmacy_cleanup_failed`)
          }
          if (isNativeFlow) return nativeError(nativeFlow, 'pharmacy_oauth_signup_not_allowed')
          return NextResponse.redirect(
            `${origin}/signup?role=pharmacy&oauth=pharmacy_requires_password`,
          )
        }
        if (isNativeFlow) return nativeSession(nativeFlow, session, '/complete-profile')
        return NextResponse.redirect(new URL('/complete-profile', origin))
      }

      const role = decision.role
      let redirectSession = session

      if (session.user.user_metadata?.role !== role) {
        const { error: updateError } = await supabase.auth.updateUser({ data: { role } })
        if (updateError && isNativeFlow) {
          return nativeError(nativeFlow, 'oauth_role_sync_failed')
        }
        if (!updateError && isNativeFlow) {
          const { data: refreshed } = await supabase.auth.refreshSession()
          if (refreshed.session) redirectSession = refreshed.session
        }
      }

      if (isNativeFlow) {
        const destination = role === 'pharmacy'
          ? '/'
          : getSafeNativeOAuthDestination(next, '/dashboard')
        return nativeSession(nativeFlow, redirectSession, destination)
      }
      return NextResponse.redirect(`${origin}${next ?? (role === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard')}`)
    }
  }

  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid_or_expired`)
  }

  if (isNativeFlow) return nativeError(nativeFlow, 'native_oauth_callback_failed')

  // Fallback URL if no session is established
  return NextResponse.redirect(`${origin}/login`)
}
