import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getEnrichedInventory } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'
import { checkStaffPermission } from '@/lib/staff-permissions'
import { z } from 'zod'

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
    if (body.item_type !== undefined || body.product_id !== undefined) {
      return NextResponse.json(
        { error: 'Use the catalogue-link promotion action to change inventory identity' },
        { status: 400 },
      )
    }

    const promotionRequested = body.promote_to_product_id !== undefined
    if (promotionRequested) {
      const productId = z.string().uuid().safeParse(body.promote_to_product_id)
      if (!productId.success) {
        return NextResponse.json(
          { error: 'Link a valid catalogue drug to promote' },
          { status: 400 },
        )
      }
      if (
        body.price !== undefined
        || body.low_stock_threshold !== undefined
        || body.whole_pack_only !== undefined
        || body.pharmacy_image_url !== undefined
        || body.image_url !== undefined
      ) {
        return NextResponse.json(
          { error: 'Confirm promotion separately from other inventory changes' },
          { status: 400 },
        )
      }
    }
    if (body.price !== undefined) {
      const staffAccess = await checkStaffPermission(supabase as any, pharmacy.id, request, 'can_change_prices')
      if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })
    }
    // Build inventory update payload
    const inventoryUpdate: Record<string, any> = {}
    if (body.price !== undefined) inventoryUpdate.price = Number(body.price)
    if (body.low_stock_threshold !== undefined) inventoryUpdate.low_stock_threshold = Number(body.low_stock_threshold)
    if (typeof body.whole_pack_only === 'boolean') inventoryUpdate.whole_pack_only = body.whole_pack_only
    if (promotionRequested) {
      inventoryUpdate.item_type = 'medicine'
      inventoryUpdate.product_id = body.promote_to_product_id
    }
    // Pharmacy-level image override
    if (body.pharmacy_image_url !== undefined) inventoryUpdate.image_url = body.pharmacy_image_url

    let promotionBatchCaptureRequired = false
    if (Object.keys(inventoryUpdate).length > 0) {
      const { data: updateResult, error: updateError } = await (supabase.rpc as any)(
        'update_pharmacy_inventory_item',
        {
          p_inventory_id: id,
          p_patch: inventoryUpdate,
          p_sp_token: request.headers.get('x-sp-authorization'),
        },
      )

      if (updateError) {
        console.error('Error updating inventory:', updateError)
        return NextResponse.json(
          { error: updateError.message || 'Failed to update drug' },
          { status: 409 }
        )
      }
      if (updateResult?.success === false) {
        if (updateResult.code === 'SP_AUTH_REQUIRED') {
          return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
        }
        return NextResponse.json(
          { error: updateResult.error || 'Failed to update drug', code: updateResult.code },
          { status: updateResult.code === 'NOT_FOUND' ? 404 : 409 },
        )
      }
      if (promotionRequested) {
        promotionBatchCaptureRequired = updateResult?.batch_capture_required === true
      }
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

    return NextResponse.json({
      ...drug,
      ...(promotionRequested
        ? { batch_capture_required: promotionBatchCaptureRequired }
        : {}),
    })
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
    const { data: delistResult, error: delistError } = await (supabase.rpc as any)(
      'delist_pharmacy_inventory_item',
      {
        p_inventory_id: id,
        p_sp_token: request.headers.get('x-sp-authorization'),
      },
    )

    if (delistError) {
      console.error('Error delisting drug:', delistError)
      return NextResponse.json(
        { error: delistError.message || 'Failed to remove drug from inventory. Please try again.' },
        { status: 409 }
      )
    }
    if (delistResult?.success === false) {
      if (delistResult.code === 'SP_AUTH_REQUIRED') {
        return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      }
      return NextResponse.json(
        { error: delistResult.error || 'Failed to remove drug from inventory', code: delistResult.code },
        { status: delistResult.code === 'NOT_FOUND' ? 404 : 409 },
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
