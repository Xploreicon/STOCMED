import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getEnrichedInventory } from '@/lib/pharmacyInventory'
import { inventoryItemSchema } from '@/lib/validation/inventory-item'
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

    const parsed = inventoryItemSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid inventory item' },
        { status: 400 }
      )
    }
    const item = {
      ...parsed.data,
      tracks_expiry: parsed.data.item_type === 'medicine' ? true : parsed.data.tracks_expiry,
    }
    const { data: inventoryId, error: createError } = await (supabase.rpc as any)(
      'create_inventory_item',
      { p_pharmacy_id: pharmacy.id, p_item: item }
    )
    if (createError || !inventoryId) {
      console.error('Error creating inventory item:', createError)
      return NextResponse.json(
        { error: createError?.message || 'Failed to create inventory item' },
        { status: createError?.message?.includes('already') ? 409 : 400 }
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

    const drug = createdInventory.rows.find((row) => row.id === inventoryId)
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
