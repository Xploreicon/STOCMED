const clearers = new Set<() => void>()

export function registerAccountCache(clear: () => void) {
  clearers.add(clear)
  return () => { clearers.delete(clear) }
}
export function clearAccountCaches() {
  for (const clear of clearers) { try { clear() } catch { /* A cache failure must not prevent identity reset. */ } }
  if (typeof window !== 'undefined') {
    for (const key of ['stocmed:userLocation', 'search-storage']) {
      try { window.localStorage.removeItem(key) } catch { /* Storage may be disabled; reset in-memory identity regardless. */ }
    }
  }
}
export function clearForAccountChange(previous: string | null, next: string | null) {
  if (previous === next) return false
  clearAccountCaches()
  return true
}
