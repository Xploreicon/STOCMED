const subscribers = new Set<() => void>()
export function subscribeAuthRevalidation(callback: () => void) {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}
export function requestAuthRevalidation() { for (const callback of subscribers) callback() }
