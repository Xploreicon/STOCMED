import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { MOVEMENT_TYPE_MAP, MovementUiType } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'
import { checkStaffPermission } from '@/lib/staff-permissions'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)

    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    const staffAccess = await checkStaffPermission(supabase as any, pharmacy.id, request, 'can_adjust_stock')
    if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })

    const { data: inventoryRow, error: checkError } = await supabase
      .from('pharmacy_inventory')
      .select('pharmacy_id')
      .eq('id', id)
      .single()

    if (checkError || !inventoryRow) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 })
    }

    if ((inventoryRow as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Medication does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { type, batch_id, quantity, reason } = body as {
      type: MovementUiType
      batch_id?: string | null
      quantity: number | string
      reason: string
    }

    const movementDef = MOVEMENT_TYPE_MAP[type]
    if (!movementDef || movementDef.db === 'sale') {
      return NextResponse.json(
        { error: 'Movement type must be one of Restock, Adjustment, Return, Write-off, Expiry' },
        { status: 400 }
      )
    }

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'A reason is required for every stock change' }, { status: 400 })
    }

    const rawQuantity = Number(quantity)
    if (!Number.isInteger(rawQuantity) || rawQuantity === 0) {
      return NextResponse.json({ error: 'Quantity must be a non-zero whole number' }, { status: 400 })
    }

    let signedQuantity: number
    if (movementDef.sign === 'positive') {
      signedQuantity = Math.abs(rawQuantity)
    } else if (movementDef.sign === 'negative') {
      signedQuantity = -Math.abs(rawQuantity)
    } else {
      signedQuantity = rawQuantity
    }

    if (batch_id) {
      const { data: batch, error: batchCheckError } = await supabase
        .from('batches')
        .select('inventory_id')
        .eq('id', batch_id)
        .single()

      if (batchCheckError || !batch || (batch as any).inventory_id !== id) {
        return NextResponse.json({ error: 'Batch does not belong to this medication' }, { status: 400 })
      }
    }

    const { data: movement, error: movementError } = await (supabase.rpc as any)(
      'record_guarded_stock_adjustment',
      {
        p_inventory_id: id,
        p_type: movementDef.db,
        p_quantity: signedQuantity,
        p_reason: reason.trim(),
        p_batch_id: batch_id || null,
        p_new_batch_number: null,
        p_new_batch_expiry_date: null,
        p_new_batch_cost_price: null,
        p_sp_token: request.headers.get('x-sp-authorization'),
      }
    )

    if (movementError) {
      console.error('Error recording stock movement:', movementError)
      return NextResponse.json({ error: movementError.message || 'Failed to record stock movement' }, { status: 409 })
    }
    if (movement?.success === false) {
      if (movement.code === 'SP_AUTH_REQUIRED') {
        return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      }
      return NextResponse.json(
        { error: movement.error || 'Failed to record stock movement', code: movement.code },
        { status: movement.code === 'NOT_FOUND' ? 404 : 409 },
      )
    }

    const { data: updatedInventory, error: refetchError } = await supabase
      .from('pharmacy_inventory')
      .select('*')
      .eq('id', id)
      .single()

    if (refetchError) {
      console.error('Error refetching inventory after adjustment:', refetchError)
    }

    return NextResponse.json({ movement: movement?.movement ?? movement, inventory: updatedInventory ?? null }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
