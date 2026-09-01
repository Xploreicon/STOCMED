import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

let singleton: SupabaseClient<Database> | null = null

export function getAdminClient() {
  if (singleton) return singleton

  // Server-only jobs should address the Supabase project directly. The public
  // URL may be a custom auth proxy and is retained only as a compatibility
  // fallback for environments that have not set SUPABASE_ADMIN_URL yet.
  const url = process.env.SUPABASE_ADMIN_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
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
