import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildNativeOAuthErrorUrl,
  getSafeNativeOAuthDestination,
  isNativeOAuthFlow,
} from '@/lib/auth/native-oauth'

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const flow = requestUrl.searchParams.get('flow')
  if (!isNativeOAuthFlow(flow)) {
    return new NextResponse('Invalid native OAuth request.', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const callback = new URL('/auth-callback', requestUrl.origin)
  callback.searchParams.set('native', '1')
  callback.searchParams.set('flow', flow)

  const requestedNext = requestUrl.searchParams.get('next')
  if (requestedNext) {
    callback.searchParams.set('next', getSafeNativeOAuthDestination(requestedNext))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error || !data.url) {
    return noStore(NextResponse.redirect(
      buildNativeOAuthErrorUrl(flow, 'native_oauth_start_failed'),
      303,
    ))
  }

  return noStore(NextResponse.redirect(data.url, 303))
}
