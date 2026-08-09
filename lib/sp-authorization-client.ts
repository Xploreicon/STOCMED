'use client'

import type { SpAction } from '@/lib/sp-authorization'

const prefix = 'stocmed-sp-grant:'

export function spAuthorizationRequiredError(message: string) {
  const error = new Error(message)
  error.name = 'SP_AUTH_REQUIRED'
  return error
}

export function isSpAuthorizationRequired(error: unknown) {
  return error instanceof Error && error.name === 'SP_AUTH_REQUIRED'
}

export function getCachedSpToken(action: SpAction) {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(`${prefix}${action}`)
}

export function cacheSpToken(action: SpAction, token: string) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(`${prefix}${action}`, token)
}

export function clearCachedSpToken(action: SpAction) {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(`${prefix}${action}`)
}

export function withSpAuthorizationHeader(
  action: SpAction,
  token: string | null,
  headers: HeadersInit = {},
) {
  const next = new Headers(headers)
  const resolved = token || getCachedSpToken(action)
  if (resolved) next.set('x-sp-authorization', resolved)
  return next
}
