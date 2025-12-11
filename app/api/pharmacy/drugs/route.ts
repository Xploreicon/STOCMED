import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
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

    // Fetch all drugs for this pharmacy
    const { data: drugs, error: drugsError } = await supabase
      .from('drugs')
      .select('*')
      .eq('pharmacy_id', pharmacy.id)
      .order('created_at', { ascending: false })

    if (drugsError) {
      console.error('Error fetching drugs:', drugsError)
      return NextResponse.json(
        { error: 'Failed to fetch drugs' },
        { status: 500 }
      )
    }

    // Calculate stats
    const stats = {
      total: drugs.length,
      in_stock: drugs.filter((d: any) => d.quantity_in_stock > d.low_stock_threshold).length,
      low_stock: drugs.filter((d: any) => d.quantity_in_stock > 0 && d.quantity_in_stock <= d.low_stock_threshold).length,
      out_of_stock: drugs.filter((d: any) => d.quantity_in_stock === 0).length,
    }

    return NextResponse.json({
      drugs,
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

    // Parse request body
    const body = await request.json()

    // Validate required fields
    const requiredFields = ['name', 'category', 'dosage_form', 'price', 'quantity_in_stock']
    const missingFields = requiredFields.filter(field => !body[field])

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Insert drug
    const { data: drug, error: insertError } = await (supabase
      .from('drugs') as any)
      .insert({
        pharmacy_id: pharmacy.id,
        name: body.name,
        generic_name: body.generic_name || null,
        brand_name: body.brand_name || null,
        category: body.category,
        dosage_form: body.dosage_form,
        strength: body.strength || null,
        description: body.description || null,
        price: body.price,
        quantity_in_stock: body.quantity_in_stock,
        low_stock_threshold: body.low_stock_threshold || 10,
        requires_prescription: body.requires_prescription || false,
        manufacturer: body.manufacturer || null,
        expiry_date: body.expiry_date || null,
        image_url: body.image_url || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting drug:', insertError)
      return NextResponse.json(
        { error: 'Failed to create drug' },
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
