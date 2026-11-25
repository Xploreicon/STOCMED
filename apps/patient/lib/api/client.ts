import { getPublicApiOrigin } from '@/lib/config'
import { createClient } from '@/lib/supabase/client'
import { requestAuthRevalidation } from '@/lib/auth/revalidation'

const methods: Record<string, readonly string[]> = {
  '/api/searches': ['GET', 'POST'], '/api/triage': ['POST'], '/api/chat/assistant': ['POST'],
  '/api/drugs/search': ['GET'], '/api/reservations': ['GET', 'POST', 'PATCH'],
  '/api/reservations/prescription': ['GET', 'POST'], '/api/notifications/preferences': ['GET', 'PUT'],
  '/api/privacy/delete-my-data': ['DELETE'], '/auth/native/complete': ['POST'],
}
export type NativeRequestInit = RequestInit & { expectedUserId?: string }

export class NativeRequestError extends Error {
  constructor(message: string, public readonly code: string, public readonly revalidate = false) {
    super(message); this.name = 'NativeRequestError'
  }
}

export function patientApiUrl(path: string, method = 'GET'): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new NativeRequestError('This request is not available in the patient app.', 'invalid_api_path')
  }
  const origin = getPublicApiOrigin()
  const url = new URL(path, origin)
  if (url.origin !== origin || url.hash || !methods[url.pathname]?.includes(method.toUpperCase())) {
    throw new NativeRequestError('This request is not available in the patient app.', 'unsupported_api_request')
  }
  return url
}

/** Trusted website endpoints use the current user token, never website cookies. */
export async function nativeFetch(path: string, options: NativeRequestInit = {}): Promise<Response> {
  const { expectedUserId, ...init } = options
  if (init.signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError')
  const method = (init.method || 'GET').toUpperCase()
  const url = patientApiUrl(path, method)
  const { data: { session }, error } = await createClient().auth.getSession()
  if (error || !session?.access_token) {
    requestAuthRevalidation()
    throw new NativeRequestError('Please sign in again to continue.', 'session_missing', true)
  }
  if (init.signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError')
  if (expectedUserId && session.user?.id !== expectedUserId) {
    throw new DOMException('The account changed before this request could be sent.', 'AbortError')
  }
  const headers = new Headers(init.headers)
  headers.delete('Cookie'); headers.delete('Origin')
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) headers.delete('Content-Type')
  headers.set('Authorization', `Bearer ${session.access_token}`)
  let response: Response
  try {
    response = await fetch(url.href, { ...init, method, headers, credentials: 'omit', cache: 'no-store', redirect: 'manual' })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new NativeRequestError('The service could not be reached. Please retry.', 'request_failed')
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    requestAuthRevalidation()
    throw new NativeRequestError('Your account needs to be checked before continuing.', 'profile_revalidation_required', true)
  }
  if (response.status === 401 || response.status === 403) requestAuthRevalidation()
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const expected = contentType.includes('application/json') || contentType.includes('+json')
    || (url.pathname === '/api/chat/assistant' && contentType.includes('text/event-stream'))
  if (response.status !== 204 && !expected) {
    requestAuthRevalidation()
    throw new NativeRequestError('Your account needs to be checked before continuing.', 'profile_revalidation_required', true)
  }
  // Return the real Response (including SSE, multipart errors and 401/403) to
  // preserve each route's contract. No automatic replay of stateful requests.
  return response
}
