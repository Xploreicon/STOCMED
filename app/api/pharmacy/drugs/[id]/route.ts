import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getEnrichedInventory } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    // Verify drug belongs to this pharmacy
    const { data: existingDrug, error: checkError } = await (supabase as any)
      .from('pharmacy_inventory')
      .select('pharmacy_id, product_id')
      .eq('id', id)
      .single()

    if (checkError || !existingDrug) {
      return NextResponse.json(
        { error: 'Drug not found' },
        { status: 404 }
      )
    }

    if ((existingDrug as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Drug does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()

    // Build inventory update payload
    const inventoryUpdate: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }
    if (body.price !== undefined) inventoryUpdate.price = Number(body.price)
    if (body.low_stock_threshold !== undefined) inventoryUpdate.low_stock_threshold = Number(body.low_stock_threshold)
    // Pharmacy-level image override
    if (body.pharmacy_image_url !== undefined) inventoryUpdate.image_url = body.pharmacy_image_url

    const { error: updateError } = await (supabase as any)
      .from('pharmacy_inventory')
      .update(inventoryUpdate)
      .eq('id', id)

    if (updateError) {
      console.error('Error updating inventory:', updateError)
      return NextResponse.json(
        { error: 'Failed to update drug' },
        { status: 500 }
      )
    }

    // Update catalogue-level product image if provided
    if (body.image_url !== undefined) {
      const { error: productUpdateError } = await (supabase.rpc as any)(
        'set_stocked_product_image',
        {
          p_pharmacy_id: pharmacy.id,
          p_product_id: (existingDrug as any).product_id,
          p_image_url: body.image_url ?? null,
        }
      )

      if (productUpdateError) {
        console.error('Error updating product image:', productUpdateError)
        return NextResponse.json(
          { error: 'Failed to update drug image' },
          { status: 500 }
        )
      }
    }

    let updatedInventory
    try {
      updatedInventory = await getEnrichedInventory(supabase, pharmacy.id, { showDelisted: true })
    } catch (fetchError) {
      console.error('Error fetching updated inventory item:', fetchError)
      return NextResponse.json(
        { error: 'Failed to retrieve updated drug profile' },
        { status: 500 }
      )
    }

    const drug = updatedInventory.rows.find((row) => row.id === id)
    if (!drug) {
      return NextResponse.json({ error: 'Drug not found' }, { status: 404 })
    }

    return NextResponse.json(drug)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    // Verify drug belongs to this pharmacy
    const { data: existingDrug, error: checkError } = await (supabase as any)
      .from('pharmacy_inventory')
      .select('pharmacy_id, deleted_at')
      .eq('id', id)
      .single()

    if (checkError || !existingDrug) {
      return NextResponse.json(
        { error: 'Drug not found' },
        { status: 404 }
      )
    }

    if ((existingDrug as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Drug does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    // Inventory is append-only for audit and reservation integrity. Removing an
    // item from the UI always delists it; ledger, batch, sale, and hold records stay.
    const { error: delistError } = await (supabase as any)
      .from('pharmacy_inventory')
      .update({
        deleted_at: new Date().toISOString(),
        is_listed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (delistError) {
      console.error('Error delisting drug:', delistError)
      return NextResponse.json(
        { error: 'Failed to remove drug from inventory. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Drug removed from active inventory. Sales history and ledger records have been preserved.',
      action: 'delisted',
      id,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
