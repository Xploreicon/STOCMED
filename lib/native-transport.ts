/** Exact routes and methods for the packaged patient app transport. */
const nativeMethods: Record<string, readonly string[]> = {
  '/api/searches': ['GET', 'POST'],
  '/api/triage': ['POST'],
  '/api/chat/assistant': ['POST'],
  // POST is advertised for preflight, but the existing route only implements GET.
  '/api/drugs/search': ['GET', 'POST'],
  '/api/reservations': ['GET', 'POST', 'PATCH'],
  '/api/reservations/prescription': ['GET', 'POST'],
  '/api/notifications/preferences': ['GET', 'PUT'],
  '/api/privacy/delete-my-data': ['DELETE'],
  '/auth/native/complete': ['POST'],
}

// Next.js automatically supplies HEAD for GET and OPTIONS for each route.
const implementedMethods: Record<string, readonly string[]> = {
  ...nativeMethods,
  '/api/drugs/search': ['GET'],
}

export function nativeMethodsFor(pathname: string): readonly string[] | undefined {
  return nativeMethods[pathname]
}

export function isAllowedNativeOrigin(origin: string | null): origin is string {
  if (!origin || origin === 'null' || origin === '*') return false
  return (process.env.NATIVE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value && value !== '*' && value !== 'null')
    .includes(origin)
}

export function hasBearerAuthorization(request: Request): boolean {
  return /^Bearer(?:[\t ]|$)/i.test(request.headers.get('authorization') ?? '')
}

export function addNativeCors(response: Response, origin: string): Response {
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.append('Vary', 'Origin')
  return response
}

/** Preserve Next's default OPTIONS response for ordinary, non-native requests. */
export function nativeOptions(request: Request): Response {
  const path = new URL(request.url).pathname
  const allowedMethods = nativeMethodsFor(path)
  const implemented = implementedMethods[path]
  if (!allowedMethods || !implemented) return new Response(null, { status: 405 })

  const automaticAllow = [...implemented, 'OPTIONS']
  if (implemented.includes('GET')) automaticAllow.push('HEAD')
  const allow = [...new Set(automaticAllow)].sort().join(', ')
  const origin = request.headers.get('origin')

  if (hasBearerAuthorization(request) && !isAllowedNativeOrigin(origin)) {
    return Response.json({ error: 'native_origin_forbidden' }, { status: 403 })
  }
  if (!isAllowedNativeOrigin(origin)) {
    return new Response(null, { status: 204, headers: { Allow: allow } })
  }

  const requestedMethod = request.headers.get('access-control-request-method')
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if ((requestedMethod && !allowedMethods.includes(requestedMethod.toUpperCase()))
    || requestedHeaders.some(value => value !== 'authorization' && value !== 'content-type')) {
    return addNativeCors(new Response(null, { status: 403 }), origin)
  }

  return new Response(null, {
    status: 204,
    headers: {
      Allow: allow,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': allowedMethods.join(', '),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    },
  })
}
