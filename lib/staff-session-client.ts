'use client'

export const STAFF_SESSION_STORAGE_KEY = 'stocmed-staff-session'

export type StaffPermissions = {
  can_sell: boolean
  can_adjust_stock: boolean
  can_view_reports: boolean
  can_change_prices: boolean
  can_refund: boolean
}

export type StaffSession = {
  token: string
  expires_at: string
  staff: {
    id: string
    name: string
    role: string
    permissions: StaffPermissions
  }
}

export function getStaffSession(): StaffSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STAFF_SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as StaffSession
    if (!value?.token || !value?.staff?.id || new Date(value.expires_at).getTime() <= Date.now()) {
      clearStaffSession()
      return null
    }
    return value
  } catch {
    clearStaffSession()
    return null
  }
}

export function cacheStaffSession(session: StaffSession) {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(session))
    window.dispatchEvent(new Event('stocmed-staff-session-changed'))
  }
}

export function clearStaffSession() {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(STAFF_SESSION_STORAGE_KEY)
    window.dispatchEvent(new Event('stocmed-staff-session-changed'))
  }
}

export function withStaffSessionHeader(headers: HeadersInit = {}, token?: string | null) {
  const next = new Headers(headers)
  const resolved = token ?? getStaffSession()?.token
  if (resolved) next.set('x-staff-session', resolved)
  return next
}
