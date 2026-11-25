import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { shouldCompleteOAuthProfile } from '@/lib/auth/google-oauth-policy'
import { addNativeCors, hasBearerAuthorization, isAllowedNativeOrigin, nativeMethodsFor } from '@/lib/native-transport'
import { createClient as createCookieClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'

export { nativeOptions } from '@/lib/native-transport'

type RequestClient = Awaited<ReturnType<typeof createCookieClient>>
type BearerContext = { client: RequestClient; user: User; token: string }

class NativeTransportError extends Error {
  constructor(readonly status: 401 | 403, readonly code: string) {
    super(code)
  }
}

const bearerContexts = new WeakMap<Request, Promise<BearerContext>>()

async function validateBearer(request: Request): Promise<BearerContext> {
  const origin = request.headers.get('origin')
  if (!isAllowedNativeOrigin(origin)) {
    throw new NativeTransportError(403, 'native_origin_forbidden')
  }

  const authorization = request.headers.get('authorization') ?? ''
  const token = /^Bearer[\t ]+([^\t \r\n]+)$/i.exec(authorization)?.[1]
  if (!token) throw new NativeTransportError(401, 'invalid_bearer_token')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const validator = createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: { user }, error } = await validator.auth.getUser(token)
  if (error || !user) throw new NativeTransportError(401, 'invalid_bearer_token')

  const client = createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  // The installed SSR adapter and supabase-js expose different generic versions.
  return { client: client as unknown as RequestClient, user, token }
}

function bearerContext(request: Request): Promise<BearerContext> {
  let context = bearerContexts.get(request)
  if (!context) {
    context = validateBearer(request)
    bearerContexts.set(request, context)
  }
  return context
}

/** Cookie requests retain the existing SSR client; bearer requests are user scoped. */
export async function createRequestClient(request: Request): Promise<RequestClient> {
  if (!nativeMethodsFor(new URL(request.url).pathname)?.includes(request.method)
    || !hasBearerAuthorization(request)) return createCookieClient()
  return (await bearerContext(request)).client
}

/** Run before a handler can perform any reads, side effects, or streaming. */
export function withNativeTransport<T extends Request>(handler: (request: T) => Promise<Response>) {
  return async (request: T): Promise<Response> => {
    if (!nativeMethodsFor(new URL(request.url).pathname)?.includes(request.method)) {
      return handler(request)
    }
    const origin = request.headers.get('origin')
    if (hasBearerAuthorization(request)) {
      try {
        const { user } = await bearerContext(request)
        // The existing cookie middleware applies this redirect to matched routes.
        // A bearer-only request has no middleware cookie, so preserve that rule here.
        if (shouldCompleteOAuthProfile(user.user_metadata?.role, new URL(request.url).pathname)) {
          return addNativeCors(NextResponse.redirect(new URL('/complete-profile', request.url)), origin!)
        }
      } catch (error) {
        const transportError = error instanceof NativeTransportError
          ? error
          : new NativeTransportError(401, 'invalid_bearer_token')
        const response = NextResponse.json({ error: transportError.code }, { status: transportError.status })
        return isAllowedNativeOrigin(origin) ? addNativeCors(response, origin) : response
      }
    }
    const response = await handler(request)
    if (!isAllowedNativeOrigin(origin)) return response
    // The preserved 405 must not be cached across origin-specific responses.
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/drugs/search') {
      response.headers.set('Cache-Control', 'no-store')
    }
    return addNativeCors(response, origin)
  }
}

/** Auth's updateUser requires a stored session; use the validated user JWT for native requests. */
export async function updateRequestUserRole(request: Request, client: RequestClient, role: 'patient' | 'pharmacy') {
  if (!hasBearerAuthorization(request)) return client.auth.updateUser({ data: { role } })
  const { token } = await bearerContext(request)
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { role } }),
      cache: 'no-store',
    })
    return { error: response.ok ? null : new Error('Native user role update failed') }
  } catch {
    return { error: new Error('Native user role update failed') }
  }
}

/** Mirror auth.signOut's global scope without inventing a refresh-token session. */
export async function signOutRequest(request: Request, client: RequestClient) {
  if (!hasBearerAuthorization(request)) return client.auth.signOut()
  const { token } = await bearerContext(request)
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })
    return { error: response.ok || [401, 403, 404].includes(response.status) ? null : new Error('Native sign out failed') }
  } catch {
    return { error: new Error('Native sign out failed') }
  }
}
