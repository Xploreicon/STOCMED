import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getEnrichedInventory } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const showDelisted = request.nextUrl.searchParams.get('show_delisted') === 'true'

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
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    let inventory
    try {
      inventory = await getEnrichedInventory(supabase, pharmacy.id, { showDelisted })
    } catch (inventoryError) {
      console.error('Error fetching inventory:', inventoryError)
      return NextResponse.json(
        { error: 'Failed to fetch drugs' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      drugs: inventory.rows,
      stats: inventory.stats,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

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
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    // Parse request body
    const body = await request.json()

    // Validate required fields
    const requiredFields = ['product_id', 'price', 'quantity_in_stock', 'batch_number', 'expiry_date']
    const missingFields = requiredFields.filter(field => body[field] === undefined || body[field] === null || body[field] === '')

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Check if this product is already in the pharmacy's inventory
    const { data: existingInventory, error: checkError } = await (supabase as any)
      .from('pharmacy_inventory')
      .select('id')
      .eq('pharmacy_id', pharmacy.id)
      .eq('product_id', body.product_id)
      .maybeSingle()

    if (existingInventory) {
      return NextResponse.json(
        { error: 'This product is already in your inventory. Update its stock or details instead.' },
        { status: 409 }
      )
    }

    // Create transaction manually
    // 1. Create pharmacy_inventory record
    const { data: inventory, error: invError } = await (supabase as any)
      .from('pharmacy_inventory')
      .insert({
        pharmacy_id: pharmacy.id,
        product_id: body.product_id,
        price: body.price,
        low_stock_threshold: body.low_stock_threshold !== undefined && body.low_stock_threshold !== null ? Number(body.low_stock_threshold) : 10,
        quantity_in_stock: 0, // will be updated via trigger
        is_listed: true,
        image_url: body.pharmacy_image_url || null,
      })
      .select()
      .single()

    if (invError || !inventory) {
      console.error('Error inserting pharmacy inventory:', invError)
      return NextResponse.json(
        { error: 'Failed to create inventory record' },
        { status: 500 }
      )
    }

    // 2. Create batch record
    const { data: batch, error: batchError } = await (supabase as any)
      .from('batches')
      .insert({
        inventory_id: inventory.id,
        batch_number: body.batch_number,
        expiry_date: body.expiry_date,
        quantity_received: Number(body.quantity_in_stock),
        cost_price: null
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Error inserting batch:', batchError)
      // Rollback (delete inventory item)
      await (supabase as any).from('pharmacy_inventory').delete().eq('id', inventory.id)
      return NextResponse.json(
        { error: 'Failed to create batch record' },
        { status: 500 }
      )
    }

    // 3. Create opening stock movement
    const { error: movementError } = await (supabase as any)
      .from('stock_movements')
      .insert({
        inventory_id: inventory.id,
        batch_id: batch.id,
        type: 'opening',
        quantity: Number(body.quantity_in_stock),
        reason: 'Opening stock',
        created_by: user.id
      })

    if (movementError) {
      console.error('Error inserting stock movement:', movementError)
      // Rollback
      await (supabase as any).from('batches').delete().eq('id', batch.id)
      await (supabase as any).from('pharmacy_inventory').delete().eq('id', inventory.id)
      return NextResponse.json(
        { error: 'Failed to log stock movement' },
        { status: 500 }
      )
    }

    let createdInventory
    try {
      createdInventory = await getEnrichedInventory(supabase, pharmacy.id)
    } catch (fetchError) {
      console.error('Error fetching new inventory item:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch created drug profile' },
        { status: 500 }
      )
    }

    const drug = createdInventory.rows.find((row) => row.id === inventory.id)
    if (!drug) {
      return NextResponse.json(
        { error: 'Created inventory item could not be retrieved' },
        { status: 500 }
      )
    }

    return NextResponse.json(drug, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
