import { NextResponse } from 'next/server'
import { decideGoogleOAuthDestination } from '@/lib/auth/google-oauth-policy'
import { getSafeNativeOAuthDestination } from '@/lib/auth/native-oauth'
import { isStocMedAppUserAgent } from '@/lib/native-app'
import { createClient } from '@/lib/supabase/server'

function noStore(body: Record<string, string>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request) {
  if (!isStocMedAppUserAgent(request.headers.get('user-agent'))) {
    return noStore({ error: 'native_oauth_only' }, 404)
  }

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return noStore({ error: 'native_oauth_session_missing' }, 401)
  }

  const { data: dbUser, error: profileError } = await (supabase
    .from('users')
    .select('role')
    .eq('user_id', user.id) as any)
    .maybeSingle()
  if (profileError) {
    await supabase.auth.signOut()
    return noStore({ error: 'profile_lookup_failed' }, 500)
  }

  const decision = decideGoogleOAuthDestination((dbUser as any)?.role, undefined)
  if (decision.kind !== 'existing_profile') {
    return noStore({ destination: '/complete-profile' })
  }

  const role = decision.role
  if (user.user_metadata?.role !== role) {
    const { error: updateError } = await supabase.auth.updateUser({ data: { role } })
    if (updateError) {
      await supabase.auth.signOut()
      return noStore({ error: 'oauth_role_sync_failed' }, 500)
    }
  }

  if (role === 'pharmacy') {
    return noStore({ destination: '/' })
  }

  let requestedNext: unknown
  try {
    requestedNext = (await request.json() as { next?: unknown }).next
  } catch {
    requestedNext = null
  }
  return noStore({
    destination: getSafeNativeOAuthDestination(
      typeof requestedNext === 'string' ? requestedNext : null,
    ),
  })
}
