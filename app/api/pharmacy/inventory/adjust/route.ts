import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { MOVEMENT_TYPE_MAP, type MovementUiType } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'
import { checkStaffPermission } from '@/lib/staff-permissions'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)

    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found.' },
        { status: 404 }
      )
    }

    const staffAccess = await checkStaffPermission(supabase as any, pharmacy.id, request, 'can_adjust_stock')
    if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })

    // Parse body
    const body = await request.json()
    const { inventory_id, batch_id, batch_number, expiry_date, cost_price, quantity, type, reason } = body

    if (!inventory_id || !type || quantity === undefined || quantity === null) {
      return NextResponse.json(
        { error: 'Missing required fields: inventory_id, type, quantity' },
        { status: 400 }
      )
    }

    const movementEntry = Object.entries(MOVEMENT_TYPE_MAP).find(([uiType, definition]) =>
      uiType.toLowerCase() === String(type).toLowerCase() || definition.db === type
    ) as [MovementUiType, (typeof MOVEMENT_TYPE_MAP)[MovementUiType]] | undefined
    const movementDef = movementEntry?.[1]
    if (!movementDef || movementDef.db === 'sale') {
      return NextResponse.json(
        { error: 'Movement type must be one of Restock, Adjustment, Return, Write-off, Expiry' },
        { status: 400 }
      )
    }

    const rawQuantity = Number(quantity)
    if (!Number.isInteger(rawQuantity) || rawQuantity === 0) {
      return NextResponse.json({ error: 'Quantity must be a non-zero whole number' }, { status: 400 })
    }
    const signedQuantity = movementDef.sign === 'positive'
      ? Math.abs(rawQuantity)
      : movementDef.sign === 'negative'
        ? -Math.abs(rawQuantity)
        : rawQuantity
    const movementReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : `${movementEntry?.[0] ?? type} adjustment`

    // Verify inventory belongs to this pharmacy
    const { data: inventory, error: checkError } = await (supabase as any)
      .from('pharmacy_inventory')
      .select('pharmacy_id')
      .eq('id', inventory_id)
      .single()

    if (checkError || !inventory) {
      return NextResponse.json(
        { error: 'Inventory record not found' },
        { status: 404 }
      )
    }

    if ((inventory as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    const { data: movement, error: moveError } = await (supabase.rpc as any)(
      'record_guarded_stock_adjustment',
      {
        p_inventory_id: inventory_id,
        p_type: movementDef.db,
        p_quantity: signedQuantity,
        p_reason: movementReason,
        p_batch_id: batch_id || null,
        p_new_batch_number: batch_id ? null : batch_number || null,
        p_new_batch_expiry_date: batch_id ? null : expiry_date || null,
        p_new_batch_cost_price: cost_price == null || cost_price === '' ? null : Number(cost_price),
        p_sp_token: request.headers.get('x-sp-authorization'),
      }
    )

    if (moveError) {
      console.error('Error inserting adjustment movement:', moveError)
      return NextResponse.json({ error: moveError.message || 'Failed to log stock adjustment' }, { status: 409 })
    }
    if (movement?.success === false) {
      if (movement.code === 'SP_AUTH_REQUIRED') {
        return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      }
      return NextResponse.json(
        { error: movement.error || 'Failed to log stock adjustment', code: movement.code },
        { status: movement.code === 'NOT_FOUND' ? 404 : 409 },
      )
    }

    return NextResponse.json(movement?.movement ?? movement, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
