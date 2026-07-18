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

    // Parse body
    const body = await request.json()
    const { generic_name, brand_name, manufacturer, strength, dosage_form, category, pack_size, image_url } = body

    if (!generic_name || !strength || !dosage_form || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: generic_name, strength, dosage_form, category' },
        { status: 400 }
      )
    }

    // Catalogue writes go through the ownership-checked server function. New
    // products remain unverified until StocMed completes catalogue review.
    const { data: product, error } = await (supabase.rpc as any)(
      'create_unverified_catalog_product',
      {
        p_pharmacy_id: pharmacy.id,
        p_generic_name: generic_name,
        p_brand_name: brand_name || null,
        p_manufacturer: manufacturer || null,
        p_strength: strength,
        p_dosage_form: dosage_form,
        p_category: category,
        p_pack_size: pack_size || null,
        p_image_url: image_url || null,
      }
    )

    if (error || !product) {
      console.error('Error creating unverified product:', error)
      return NextResponse.json(
        { error: error?.message || 'Failed to create product in catalogue' },
        { status: 500 }
      )
    }

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
