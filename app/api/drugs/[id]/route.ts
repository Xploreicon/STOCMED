import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

type InventoryDetails = Database['public']['Tables']['pharmacy_inventory']['Row'] & {
  products: Database['public']['Tables']['products']['Row']
  batches: Array<Pick<Database['public']['Tables']['batches']['Row'], 'expiry_date'>>
  pharmacies: Pick<
    Database['public']['Tables']['pharmacies']['Row'],
    'id' | 'pharmacy_name' | 'address' | 'city' | 'state' | 'phone' | 'latitude' | 'longitude' | 'is_verified'
  >
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Drug ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: inventory, error } = await supabase
      .from('pharmacy_inventory')
      .select(`
        *,
        products (*),
        batches (expiry_date),
        pharmacies (
          id,
          pharmacy_name,
          address,
          city,
          state,
          phone,
          latitude,
          longitude,
          is_verified
        )
      `)
      .eq('id', id)
      .returns<InventoryDetails[]>()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Drug not found' },
          { status: 404 }
        )
      }
      console.error('Error fetching drug:', error)
      return NextResponse.json(
        { error: 'Failed to fetch drug' },
        { status: 500 }
      )
    }

    const product = inventory.products
    const expiryDate = [...(inventory.batches ?? [])]
      .map((batch) => batch.expiry_date)
      .sort()[0] ?? null

    return NextResponse.json({
      id: inventory.id,
      pharmacy_id: inventory.pharmacy_id,
      product_id: inventory.product_id,
      name: product?.brand_name || product?.generic_name || 'Unknown product',
      generic_name: product?.generic_name ?? null,
      brand_name: product?.brand_name ?? null,
      category: product?.category ?? null,
      dosage_form: product?.dosage_form ?? null,
      strength: product?.strength ?? null,
      description: product?.description ?? null,
      manufacturer: product?.manufacturer ?? null,
      pack_size: product?.pack_size ?? null,
      nafdac_number: product?.nafdac_number ?? null,
      barcode: product?.barcode ?? null,
      requires_prescription: product?.requires_prescription ?? false,
      image_url: product?.image_url ?? null,
      price: inventory.price,
      quantity_in_stock: inventory.quantity_in_stock,
      low_stock_threshold: inventory.low_stock_threshold,
      expiry_date: expiryDate,
      created_at: inventory.created_at,
      updated_at: inventory.updated_at,
      pharmacies: inventory.pharmacies,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
