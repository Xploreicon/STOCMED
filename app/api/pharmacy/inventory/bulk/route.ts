import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { checkStaffPermission } from '@/lib/staff-permissions'
import { inventoryBulkSchema } from '@/lib/validation/inventory-bulk'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'

export async function POST(request: NextRequest) {
  try {
    const parsed = inventoryBulkSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid selection' }, { status: 400 })
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const pharmacy = await ensurePharmacyRecord(supabase, user)
    if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
    const staff = await checkStaffPermission(supabase as any, pharmacy.id, request, 'can_adjust_stock')
    if (!staff.allowed) return NextResponse.json({ error: staff.error, code: staff.code }, { status: 403 })
    const { data, error } = await (supabase.rpc as any)('bulk_change_pharmacy_inventory', {
      p_pharmacy_id: pharmacy.id,
      p_inventory_ids: parsed.data.ids,
      p_action: parsed.data.action,
      p_reason: parsed.data.reason || null,
      p_sp_token: request.headers.get('x-sp-authorization'),
    })
    if (error) return NextResponse.json({ error: 'The selection could not be changed. Refresh inventory and try again.' }, { status: 409 })
    if (!data?.success) {
      if (data?.code === 'SP_AUTH_REQUIRED') return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      return NextResponse.json({ error: data?.error || 'The selection could not be changed', code: data?.code }, { status: data?.code === 'NOT_FOUND' ? 404 : 409 })
    }
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    console.error('Bulk inventory action failed:', error)
    return NextResponse.json({ error: 'Inventory could not be changed. Please try again.' }, { status: 500 })
  }
}
