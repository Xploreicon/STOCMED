import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

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

    const { sales } = await request.json()

    if (!sales || !Array.isArray(sales)) {
      return NextResponse.json(
        { error: 'Invalid payload: sales must be an array' },
        { status: 400 }
      )
    }

    const syncedIds: string[] = []
    const failedIds: Array<{ id: string; error: string }> = []

    for (const sale of sales) {
      const { id, subtotal, discount, total, payment_method, created_at, items } = sale

      try {
        // Idempotency check: see if sale already exists
        const { data: existingSale } = await supabase
          .from('sales')
          .select('id')
          .eq('id', id)
          .maybeSingle()

        if (existingSale) {
          syncedIds.push(id)
          continue
        }

        // 1. Insert sale record in 'pending' status
        const { error: saleErr } = await supabase
          .from('sales')
          .insert({
            id,
            pharmacy_id: pharmacy.id,
            cashier_id: user.id,
            subtotal,
            discount,
            total,
            payment_method,
            status: 'pending',
            created_at: created_at || new Date().toISOString()
          })

        if (saleErr) {
          throw new Error(`Failed to create sale: ${saleErr.message}`)
        }

        // 2. Insert all sale items
        const saleItemsToInsert = items.map((item: any) => ({
          sale_id: id,
          inventory_id: item.inventory_id,
          batch_id: item.batch_id || null,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          line_total: Number(item.line_total)
        }))

        const { error: itemsErr } = await supabase
          .from('sale_items')
          .insert(saleItemsToInsert)

        if (itemsErr) {
          // Clean up the pending sale since insertion failed
          await supabase.from('sales').delete().eq('id', id)
          throw new Error(`Failed to create sale items: ${itemsErr.message}`)
        }

        // 3. Update status to 'completed' to fire ledger trigger
        const { error: completeErr } = await supabase
          .from('sales')
          .update({ status: 'completed', synced_at: new Date().toISOString() })
          .eq('id', id)

        if (completeErr) {
          throw new Error(`Failed to finalize sale: ${completeErr.message}`)
        }

        syncedIds.push(id)
      } catch (err: any) {
        console.error(`Error syncing sale ${id}:`, err)
        failedIds.push({ id, error: err.message || 'Unknown error' })
      }
    }

    return NextResponse.json({
      success: true,
      syncedIds,
      failedIds
    })
  } catch (error: any) {
    console.error('POS sync error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error during POS sync' },
      { status: 500 }
    )
  }
}
