import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { MOVEMENT_TYPE_MAP, type MovementUiType } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'

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

    // Parse body
    const body = await request.json()
    const { inventory_id, batch_id, batch_number, expiry_date, quantity, type, reason } = body

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

    let finalBatchId = batch_id

    // If restocking with a new batch
    if (!finalBatchId && batch_number && expiry_date) {
      const { data: newBatch, error: batchErr } = await (supabase as any)
        .from('batches')
        .insert({
          inventory_id,
          batch_number,
          expiry_date,
          quantity_received: Math.max(0, signedQuantity),
          cost_price: null
        })
        .select()
        .single()

      if (batchErr || !newBatch) {
        console.error('Error creating batch for adjustment:', batchErr)
        return NextResponse.json(
          { error: 'Failed to create new batch for restocking' },
          { status: 500 }
        )
      }
      finalBatchId = newBatch.id
    }

    if (!finalBatchId) {
      return NextResponse.json(
        { error: 'A batch selection or new batch details are required.' },
        { status: 400 }
      )
    }

    const { data: movement, error: moveError } = await (supabase.rpc as any)(
      'create_guarded_stock_adjustment',
      {
        p_pharmacy_id: pharmacy.id,
        p_inventory_id: inventory_id,
        p_batch_id: finalBatchId,
        p_type: movementDef.db,
        p_quantity: signedQuantity,
        p_reason: movementReason,
      }
    )

    if (moveError) {
      console.error('Error inserting adjustment movement:', moveError)
      return NextResponse.json({ error: moveError.message || 'Failed to log stock adjustment' }, { status: 409 })
    }

    return NextResponse.json(movement, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
