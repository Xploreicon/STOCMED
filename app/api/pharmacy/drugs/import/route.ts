import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

interface ImportRow {
  product_id?: string
  new_product?: {
    generic_name: string
    brand_name?: string
    strength: string
    dosage_form?: string
    category?: string
    pack_size?: string
    manufacturer?: string
    image_url?: string
  }
  price: number | string
  quantity: number | string
  batch_number?: string
  expiry_date?: string
  low_stock_threshold?: number | string
}

const MAX_ROWS = 1000

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json()
    const rows: ImportRow[] = body.rows

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `A single import is limited to ${MAX_ROWS} rows` }, { status: 400 })
    }

    const results: Array<{ row: number; success: boolean; id?: string; error?: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        if (!row.product_id && !row.new_product) {
          throw new Error('Row is missing a catalogue match or new product details')
        }
        if (row.price === undefined || row.price === null || Number.isNaN(Number(row.price))) {
          throw new Error('Missing or invalid price')
        }

        let resolvedProductId = row.product_id

        if (!resolvedProductId && row.new_product) {
          if (!row.new_product.generic_name || !row.new_product.strength) {
            throw new Error('New product requires at least a generic name and strength')
          }

          const { data: createdProduct, error: productError } = await (supabase.rpc as any)(
            'create_unverified_catalog_product',
            {
              p_pharmacy_id: pharmacy.id,
              p_generic_name: row.new_product.generic_name,
              p_brand_name: row.new_product.brand_name || null,
              p_manufacturer: row.new_product.manufacturer || null,
              p_strength: row.new_product.strength,
              p_dosage_form: row.new_product.dosage_form || null,
              p_category: row.new_product.category || null,
              p_pack_size: row.new_product.pack_size || null,
              p_image_url: row.new_product.image_url || null,
            }
          )

          if (productError || !createdProduct?.id) throw new Error('Failed to create product in catalogue')
          resolvedProductId = createdProduct.id
        }

        const { data: inventoryRow, error: inventoryError } = await (supabase
          .from('pharmacy_inventory') as any)
          .insert({
            pharmacy_id: pharmacy.id,
            product_id: resolvedProductId,
            price: Number(row.price),
            low_stock_threshold: row.low_stock_threshold ? parseInt(String(row.low_stock_threshold), 10) : 10,
          })
          .select()
          .single()

        if (inventoryError) {
          throw new Error(
            inventoryError.code === '23505'
              ? 'Already in your inventory — skipped'
              : 'Failed to create inventory row'
          )
        }

        const quantityNum = row.quantity ? parseInt(String(row.quantity), 10) : 0
        let batchId: string | null = null

        if (row.batch_number && row.expiry_date) {
          const { data: batch, error: batchError } = await (supabase
            .from('batches') as any)
            .insert({
              inventory_id: inventoryRow.id,
              batch_number: row.batch_number,
              expiry_date: row.expiry_date,
              quantity_received: quantityNum,
            })
            .select()
            .single()

          if (batchError) throw new Error('Failed to record batch')
          batchId = batch.id
        }

        if (quantityNum > 0) {
          const { error: movementError } = await (supabase.rpc as any)(
            'create_guarded_stock_adjustment',
            {
              p_pharmacy_id: pharmacy.id,
              p_inventory_id: inventoryRow.id,
              p_batch_id: batchId,
              p_type: 'opening',
              p_quantity: quantityNum,
              p_reason: 'Bulk import opening stock',
            }
          )
          if (movementError) throw new Error('Failed to record opening stock')
        }

        results.push({ row: i, success: true, id: inventoryRow.id })
      } catch (rowError: any) {
        results.push({ row: i, success: false, error: rowError.message || 'Unknown error' })
      }
    }

    const succeeded = results.filter((r) => r.success).length

    return NextResponse.json({
      results,
      summary: { total: rows.length, succeeded, failed: rows.length - succeeded },
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
