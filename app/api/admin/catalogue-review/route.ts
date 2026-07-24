import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select('is_admin,admin_authorized_at,admin_authorization_basis')
    .eq('user_id', user.id)
    .maybeSingle()
  
  const isAuthorizedAdmin = Boolean(
    viewer?.is_admin
    && viewer?.admin_authorized_at
    && viewer?.admin_authorization_basis?.trim()
  )
  if (!isAuthorizedAdmin) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, is_verified, created_at, updated_at')
    .eq('is_verified', false)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ products: data }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
