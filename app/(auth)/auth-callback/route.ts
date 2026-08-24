import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { decideGoogleOAuthDestination } from '@/lib/auth/google-oauth-policy'
import { getAdminClient } from '@/lib/supabase/admin'

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
            return NextResponse.redirect(`${origin}/login?error=oauth_pharmacy_cleanup_failed`)
          }
          return NextResponse.redirect(
            `${origin}/signup?role=pharmacy&oauth=pharmacy_requires_password`,
          )
        }
        return NextResponse.redirect(new URL('/complete-profile', origin))
      }

      const role = decision.role

      if (session.user.user_metadata?.role !== role) {
        await supabase.auth.updateUser({ data: { role } })
      }

      return NextResponse.redirect(`${origin}${next ?? (role === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard')}`)
    }
  }

  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid_or_expired`)
  }

  // Fallback URL if no session is established
  return NextResponse.redirect(`${origin}/login`)
}
