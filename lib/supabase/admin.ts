import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

let singleton: SupabaseClient<Database> | null = null

export function getAdminClient() {
  if (singleton) return singleton

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        'SUPABASE_SERVICE_ROLE_KEY is not set. Admin queries will be skipped.'
      )
    }
    return null
  }

  singleton = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })

  return singleton
}
