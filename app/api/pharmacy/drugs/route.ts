import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getEnrichedInventory } from '@/lib/pharmacyInventory'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

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

    const { rows, stats } = await getEnrichedInventory(supabase, pharmacy.id)

    return NextResponse.json({
      drugs: rows,
      stats,
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
    const supabase = await createClient()

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

    const body = await request.json()
    const {
      product_id,
      new_product,
      price,
      opening_stock,
      batch_number,
      expiry_date,
      low_stock_threshold,
    } = body

    if (!product_id && !new_product) {
      return NextResponse.json(
        { error: 'Select a product from the catalogue or provide a new product to add' },
        { status: 400 }
      )
    }

    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return NextResponse.json({ error: 'Price is required' }, { status: 400 })
    }

    const openingStockNum = opening_stock ? parseInt(opening_stock, 10) : 0

    if (openingStockNum > 0 && (!batch_number || !expiry_date)) {
      return NextResponse.json(
        { error: 'Batch number and expiry date are required when adding opening stock' },
        { status: 400 }
      )
    }

    let resolvedProductId = product_id as string | undefined

    if (!resolvedProductId && new_product) {
      const requiredFields = ['generic_name', 'strength']
      const missing = requiredFields.filter((f) => !new_product[f])
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Missing required product fields: ${missing.join(', ')}` },
          { status: 400 }
        )
      }

      const { data: createdProduct, error: productError } = await (supabase
        .from('products') as any)
        .insert({
          generic_name: new_product.generic_name,
          brand_name: new_product.brand_name || null,
          strength: new_product.strength,
          dosage_form: new_product.dosage_form || null,
          category: new_product.category || null,
          pack_size: new_product.pack_size || null,
          manufacturer: new_product.manufacturer || null,
          is_verified: false,
        })
        .select()
        .single()

      if (productError) {
        console.error('Error creating product:', productError)
        return NextResponse.json(
          { error: 'Failed to add new product to catalogue' },
          { status: 500 }
        )
      }

      resolvedProductId = createdProduct.id
    }

    const { data: inventoryRow, error: inventoryError } = await (supabase
      .from('pharmacy_inventory') as any)
      .insert({
        pharmacy_id: pharmacy.id,
        product_id: resolvedProductId,
        price: Number(price),
        low_stock_threshold: low_stock_threshold ? parseInt(low_stock_threshold, 10) : 10,
      })
      .select()
      .single()

    if (inventoryError) {
      console.error('Error creating inventory row:', inventoryError)
      const isDuplicate = inventoryError.code === '23505'
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'This product is already in your inventory. Use Adjust stock to update its quantity.'
            : 'Failed to add medication',
        },
        { status: isDuplicate ? 409 : 500 }
      )
    }

    let batchId: string | null = null
    if (batch_number && expiry_date) {
      const { data: batch, error: batchError } = await (supabase
        .from('batches') as any)
        .insert({
          inventory_id: inventoryRow.id,
          batch_number,
          expiry_date,
          quantity_received: openingStockNum,
        })
        .select()
        .single()

      if (batchError) {
        console.error('Error creating batch:', batchError)
        return NextResponse.json({ error: 'Failed to record batch' }, { status: 500 })
      }
      batchId = batch.id
    }

    if (openingStockNum > 0) {
      const { error: movementError } = await (supabase.from('stock_movements') as any).insert({
        inventory_id: inventoryRow.id,
        batch_id: batchId,
        type: 'opening',
        quantity: openingStockNum,
        reason: 'Opening stock',
        reference: 'ADD_DRUG',
        created_by: user.id,
      })

      if (movementError) {
        console.error('Error recording opening stock movement:', movementError)
        return NextResponse.json({ error: 'Failed to record opening stock' }, { status: 500 })
      }
    }

    return NextResponse.json({ id: inventoryRow.id, product_id: resolvedProductId }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
