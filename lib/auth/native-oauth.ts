export const NATIVE_OAUTH_CALLBACK_SCHEME = 'com.askstocmed.patient:'
export const NATIVE_OAUTH_CALLBACK_HOST = 'auth-callback'
export const NATIVE_OAUTH_FLOW_STORAGE_KEY = 'stocmed:native-oauth-flow'

const BLOCKED_NATIVE_DESTINATIONS = ['/pharmacy', '/admin', '/insights', '/api']

export type NativeOAuthCallback =
  | {
      kind: 'session'
      accessToken: string
      refreshToken: string
      flow: string
      destination: string
    }
  | {
      kind: 'error'
      code: string
      flow: string
    }

export function isNativeOAuthFlow(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

export function getSafeNativeOAuthDestination(
  value: string | null | undefined,
  fallback = '/dashboard',
) {
  if (!value?.startsWith('/') || value.startsWith('//')) return fallback

  try {
    const destination = new URL(value, 'https://askstocmed.com')
    if (destination.origin !== 'https://askstocmed.com') return fallback
    if (
      BLOCKED_NATIVE_DESTINATIONS.some(blocked => (
        destination.pathname === blocked || destination.pathname.startsWith(`${blocked}/`)
      ))
    ) {
      return '/'
    }
    if (destination.pathname === '/auth' || destination.pathname.startsWith('/auth/')) {
      return fallback
    }
    if (destination.pathname === '/auth-callback') return fallback
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return fallback
  }
}

export function buildNativeOAuthSessionUrl(input: {
  accessToken: string
  refreshToken: string
  flow: string
  destination: string
}) {
  const callback = new URL(`${NATIVE_OAUTH_CALLBACK_SCHEME}//${NATIVE_OAUTH_CALLBACK_HOST}`)
  callback.hash = new URLSearchParams({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    flow: input.flow,
    next: getSafeNativeOAuthDestination(input.destination),
  }).toString()
  return callback.toString()
}

export function buildNativeOAuthErrorUrl(flow: string, code: string) {
  const callback = new URL(`${NATIVE_OAUTH_CALLBACK_SCHEME}//${NATIVE_OAUTH_CALLBACK_HOST}`)
  callback.hash = new URLSearchParams({ flow, error: code }).toString()
  return callback.toString()
}

export function parseNativeOAuthCallback(rawUrl: string): NativeOAuthCallback | null {
  try {
    const callback = new URL(rawUrl)
    if (
      callback.protocol !== NATIVE_OAUTH_CALLBACK_SCHEME
      || callback.hostname !== NATIVE_OAUTH_CALLBACK_HOST
    ) {
      return null
    }

    const params = new URLSearchParams(callback.hash.slice(1))
    const flow = params.get('flow')
    if (!isNativeOAuthFlow(flow)) return null

    const error = params.get('error')
    if (error) return { kind: 'error', code: error, flow }

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return null

    return {
      kind: 'session',
      accessToken,
      refreshToken,
      flow,
      destination: getSafeNativeOAuthDestination(params.get('next')),
    }
  } catch {
    return null
  }
}
