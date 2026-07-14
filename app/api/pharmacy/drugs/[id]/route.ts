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
      const { error: productUpdateError } = await (supabase as any)
        .from('products')
        .update({
          image_url: body.image_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existingDrug as any).product_id)

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

    // Check if this item has trade history (non-opening stock movements)
    const { count: tradeMovements, error: countError } = await (supabase as any)
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('inventory_id', id)
      .neq('type', 'opening')

    if (countError) {
      console.error('Error checking stock movements:', countError)
      return NextResponse.json(
        { error: 'Failed to check item trade history' },
        { status: 500 }
      )
    }

    const hasTradeHistory = (tradeMovements ?? 0) > 0

    if (hasTradeHistory) {
      // SOFT DELETE: Delist the item — preserve ledger, batches, and sales history
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
    } else {
      // HARD DELETE: No trade history — safe to permanently remove
      // Must delete in order: stock_movements → batches → inventory (respecting FK constraints)
      try {
        // Delete opening stock movements first
        const { error: movError } = await (supabase as any)
          .from('stock_movements')
          .delete()
          .eq('inventory_id', id)

        if (movError) {
          console.error('Error deleting stock movements:', movError)
          throw new Error('Failed to clean up stock records')
        }

        // Delete batches
        const { error: batchError } = await (supabase as any)
          .from('batches')
          .delete()
          .eq('inventory_id', id)

        if (batchError) {
          console.error('Error deleting batches:', batchError)
          throw new Error('Failed to clean up batch records')
        }

        // Delete the inventory row itself
        const { error: deleteError } = await (supabase as any)
          .from('pharmacy_inventory')
          .delete()
          .eq('id', id)

        if (deleteError) {
          console.error('Error deleting inventory row:', deleteError)
          throw new Error('Failed to delete inventory item')
        }

        return NextResponse.json({
          message: 'Drug permanently deleted. No trade history existed for this item.',
          action: 'hard_deleted',
          id,
        })
      } catch (error: any) {
        // Catch any FK constraint violations and return a friendly message
        const errorMessage = error?.message || 'Unknown error'
        const isConstraintError = errorMessage.includes('violates foreign key') ||
          errorMessage.includes('RESTRICT') ||
          errorMessage.includes('referenced from')

        if (isConstraintError) {
          // Fallback to soft delete if hard delete fails unexpectedly
          console.warn('Hard delete failed due to FK constraint, falling back to soft delete:', errorMessage)
          const { error: fallbackError } = await (supabase as any)
            .from('pharmacy_inventory')
            .update({
              deleted_at: new Date().toISOString(),
              is_listed: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)

          if (fallbackError) {
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
        }

        return NextResponse.json(
          { error: 'Failed to delete drug. Please try again or contact support.' },
          { status: 500 }
        )
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
