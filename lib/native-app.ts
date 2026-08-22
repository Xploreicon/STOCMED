export const STOCMED_APP_USER_AGENT = 'StocMedApp/1.0'

export type StocMedRole = 'patient' | 'pharmacy' | string | undefined

export function isStocMedAppUserAgent(userAgent: string | null | undefined) {
  return userAgent?.includes(STOCMED_APP_USER_AGENT) ?? false
}

export function getNativeRestrictedRedirect(pathname: string, isNativeApp: boolean) {
  if (!isNativeApp) return null
  if (
    pathname.startsWith('/pharmacy')
    || pathname.startsWith('/admin')
    || pathname === '/insights'
  ) {
    return '/'
  }
  return null
}

export function getLandingRedirect(role: StocMedRole, isNativeApp: boolean) {
  if (role === 'pharmacy') {
    return isNativeApp ? null : '/pharmacy/dashboard'
  }
  return '/dashboard'
}
