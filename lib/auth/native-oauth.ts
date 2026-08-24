export const NATIVE_OAUTH_CALLBACK_SCHEME = 'com.askstocmed.patient:'
export const NATIVE_OAUTH_CALLBACK_HOST = 'auth-callback'
export const NATIVE_OAUTH_CALLBACK_URL = `${NATIVE_OAUTH_CALLBACK_SCHEME}//${NATIVE_OAUTH_CALLBACK_HOST}`
export const NATIVE_OAUTH_FLOW_STORAGE_KEY = 'stocmed:native-oauth-flow'
export const NATIVE_OAUTH_PENDING_STORAGE_KEY = 'stocmed:native-oauth-pending'

const NATIVE_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000

const BLOCKED_NATIVE_DESTINATIONS = ['/pharmacy', '/admin', '/insights', '/api']

export type NativeOAuthCallback =
  | {
      kind: 'code'
      code: string
    }
  | {
      kind: 'session'
      accessToken: string
      refreshToken: string
      flow?: string
      destination: string
    }
  | {
      kind: 'error'
      code: string
      flow?: string
    }

export type NativeOAuthPending = {
  destination: string
  startedAt: number
}

export function getNativeGoogleOAuthOptions() {
  return {
    redirectTo: NATIVE_OAUTH_CALLBACK_URL,
    skipBrowserRedirect: true,
    scopes: 'openid email profile',
    queryParams: { prompt: 'select_account' },
  } as const
}

export function buildNativeOAuthPending(
  destination: string | null | undefined,
  startedAt = Date.now(),
) {
  return JSON.stringify({
    destination: getSafeNativeOAuthDestination(destination),
    startedAt,
  } satisfies NativeOAuthPending)
}

export function parseNativeOAuthPending(
  value: string | null | undefined,
  now = Date.now(),
): NativeOAuthPending | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<NativeOAuthPending>
    if (
      typeof parsed.startedAt !== 'number'
      || parsed.startedAt > now
      || now - parsed.startedAt > NATIVE_OAUTH_PENDING_TTL_MS
    ) {
      return null
    }
    return {
      destination: getSafeNativeOAuthDestination(parsed.destination),
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
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
  const callback = new URL(NATIVE_OAUTH_CALLBACK_URL)
  callback.hash = new URLSearchParams({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    flow: input.flow,
    next: getSafeNativeOAuthDestination(input.destination),
  }).toString()
  return callback.toString()
}

export function buildNativeOAuthErrorUrl(flow: string, code: string) {
  const callback = new URL(NATIVE_OAUTH_CALLBACK_URL)
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

    const query = callback.searchParams
    const fragment = new URLSearchParams(callback.hash.slice(1))
    const getParam = (name: string) => query.get(name) ?? fragment.get(name)

    const flow = getParam('flow')
    if (flow && !isNativeOAuthFlow(flow)) return null

    const error = getParam('error_code') ?? getParam('error')
    if (error) return { kind: 'error', code: error, ...(flow ? { flow } : {}) }

    const code = getParam('code')
    if (code) return { kind: 'code', code }

    const accessToken = getParam('access_token')
    const refreshToken = getParam('refresh_token')
    if (!accessToken || !refreshToken) return null

    return {
      kind: 'session',
      accessToken,
      refreshToken,
      ...(flow ? { flow } : {}),
      destination: getSafeNativeOAuthDestination(getParam('next')),
    }
  } catch {
    return null
  }
}
