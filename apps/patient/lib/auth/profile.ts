import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientDatabase } from '@/lib/supabase/database'

export type PatientProfile = {
  user_id: string
  role: 'patient' | 'pharmacy' | string
  full_name: string | null
  email: string | null
  phone: string | null
  location: string | null
}

export async function getPersistedProfile(client: SupabaseClient<ClientDatabase>, userId: string): Promise<PatientProfile | null> {
  const { data, error } = await client.from('users')
    .select('user_id,role,full_name,email,phone,location').eq('user_id', userId).maybeSingle().retry(false)
  if (error) throw new Error('Your account profile could not be verified. Please retry.')
  return data as unknown as PatientProfile | null
}
