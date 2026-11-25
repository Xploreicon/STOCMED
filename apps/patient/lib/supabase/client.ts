import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ClientDatabase } from './database'
import { getPublicSupabaseConfig } from '@/lib/config'
import { authStorage, SESSION_STORAGE_KEY } from '@/lib/auth/storage'

let client: SupabaseClient<ClientDatabase> | undefined

function getClient() {
  if (typeof window === 'undefined') throw new Error('Authentication is available after the app opens.')
  if (!client) {
    const { url, key } = getPublicSupabaseConfig()
    client = createSupabaseClient<ClientDatabase>(url, key, {
      auth: { flowType: 'pkce', storage: authStorage, storageKey: SESSION_STORAGE_KEY,
        persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  }
  return client
}

// A page may memoize createClient() while Next prerenders. Defer environment,
// storage and SDK initialization until a client-side effect/event uses it.
const lazyClient = new Proxy({} as SupabaseClient<ClientDatabase>, {
  get(_target, key) {
    if (key === 'then') return undefined
    const instance = getClient()
    const value = Reflect.get(instance, key, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export function createClient(): SupabaseClient<ClientDatabase> { return lazyClient }
