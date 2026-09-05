import 'server-only'
import { createClient } from '@/lib/supabase/server'

export async function getAuthorizedAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' as const, status: 401 as const }

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select('is_admin,admin_authorized_at,admin_authorization_basis')
    .eq('user_id', user.id)
    .maybeSingle()
  const allowed = Boolean(
    viewer?.is_admin
    && viewer?.admin_authorized_at
    && viewer?.admin_authorization_basis?.trim(),
  )
  if (!allowed) {
    return {
      error: 'Only a provenance-authorized StocMed administrator may perform this action' as const,
      status: 403 as const,
    }
  }
  return { supabase, user }
}
