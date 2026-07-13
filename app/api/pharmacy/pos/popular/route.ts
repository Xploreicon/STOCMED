import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Returns the top 12 most-sold items for the logged-in pharmacy,
 * ranked by total sale_items quantity descending.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)
    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found.' },
        { status: 404 }
      )
    }

    // Get top sellers by aggregating sale_items quantities via sales that
    // belong to this pharmacy. Falls back gracefully if no sales exist.
    const { data: topItems, error: queryError } = await supabase
      .rpc('get_top_sellers', { p_pharmacy_id: pharmacy.id, p_limit: 12 })

    if (queryError) {
      // If the RPC doesn't exist yet, fall back to a basic query
      console.warn('get_top_sellers RPC not available, falling back to inventory order:', queryError.message)

      const { data: fallbackItems, error: fbError } = await supabase
        .from('pharmacy_inventory')
        .select('id, product_id, price, quantity_in_stock, products(generic_name, brand_name, strength, dosage_form, barcode)')
        .eq('pharmacy_id', pharmacy.id)
        .gt('quantity_in_stock', 0)
        .order('quantity_in_stock', { ascending: false })
        .limit(12)

      if (fbError) {
        return NextResponse.json({ error: fbError.message }, { status: 500 })
      }

      const mapped = (fallbackItems || []).map((item: any) => ({
        inventory_id: item.id,
        product_id: item.product_id,
        generic_name: item.products?.generic_name || '',
        brand_name: item.products?.brand_name || null,
        strength: item.products?.strength || '',
        dosage_form: item.products?.dosage_form || null,
        barcode: item.products?.barcode || null,
        price: item.price,
        quantity_in_stock: item.quantity_in_stock,
        total_sold: 0,
      }))

      return NextResponse.json({ popular: mapped })
    }

    return NextResponse.json({ popular: topItems || [] })
  } catch (error: any) {
    console.error('Popular items error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
