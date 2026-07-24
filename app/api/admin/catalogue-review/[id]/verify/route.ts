import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
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

  try {
    const { action } = await request.json()
    const { id } = params

    if (action === 'verify') {
      const { error } = await (supabase as any)
        .from('products')
        .update({ is_verified: true, updated_at: new Date().toISOString() })
        .eq('id', id)
      
      if (error) throw error
      
      return NextResponse.json({ success: true })
    } 
    
    if (action === 'reject') {
      // Attempt to delete. This will fail if there's a foreign key constraint from pharmacy_inventory
      const { error } = await (supabase as any)
        .from('products')
        .delete()
        .eq('id', id)
      
      if (error) {
        if (error.code === '23503') {
          return NextResponse.json(
            { error: 'Cannot reject this product because it is currently in use by a pharmacy inventory.' },
            { status: 400 }
          )
        }
        throw error
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
