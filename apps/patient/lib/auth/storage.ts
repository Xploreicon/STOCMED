import type { SupportedStorage } from '@supabase/supabase-js'

export const SESSION_STORAGE_KEY = 'stocmed:patient:session:v1'

/** Session and PKCE verifier stay in the originating WebView's storage. */
export const authStorage: SupportedStorage = {
  getItem(key) {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
  },
  setItem(key, value) {
    if (typeof window === 'undefined') throw new Error('Session storage is unavailable.')
    window.localStorage.setItem(key, value)
  },
  removeItem(key) {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
  },
}
