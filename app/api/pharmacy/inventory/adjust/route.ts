import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
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
          quantity_received: Math.max(0, Number(quantity)),
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

    // Insert stock movement
    const { data: movement, error: moveError } = await (supabase as any)
      .from('stock_movements')
      .insert({
        inventory_id,
        batch_id: finalBatchId,
        type,
        quantity: Number(quantity),
        reason: reason || `${type.charAt(0).toUpperCase() + type.slice(1)} adjustment`,
        created_by: user.id
      })
      .select()
      .single()

    if (moveError) {
      console.error('Error inserting adjustment movement:', moveError)
      return NextResponse.json(
        { error: 'Failed to log stock adjustment' },
        { status: 500 }
      )
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
