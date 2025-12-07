import { createClient } from '@/lib/supabase/server'
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

    // Get pharmacy for this user
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (pharmacyError || !pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy not found' },
        { status: 404 }
      )
    }

    // Verify drug belongs to this pharmacy
    const { data: existingDrug, error: checkError } = await supabase
      .from('drugs')
      .select('pharmacy_id')
      .eq('id', id)
      .single()

    if (checkError || !existingDrug) {
      return NextResponse.json(
        { error: 'Drug not found' },
        { status: 404 }
      )
    }

    if (existingDrug.pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Drug does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()

    // Update drug
    const { data: drug, error: updateError } = await supabase
      .from('drugs')
      .update({
        name: body.name,
        generic_name: body.generic_name,
        brand_name: body.brand_name,
        category: body.category,
        dosage_form: body.dosage_form,
        strength: body.strength,
        description: body.description,
        price: body.price,
        quantity_in_stock: body.quantity_in_stock,
        low_stock_threshold: body.low_stock_threshold,
        requires_prescription: body.requires_prescription,
        manufacturer: body.manufacturer,
        expiry_date: body.expiry_date,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating drug:', updateError)
      return NextResponse.json(
        { error: 'Failed to update drug' },
        { status: 500 }
      )
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

    // Get pharmacy for this user
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (pharmacyError || !pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy not found' },
        { status: 404 }
      )
    }

    // Verify drug belongs to this pharmacy
    const { data: existingDrug, error: checkError } = await supabase
      .from('drugs')
      .select('pharmacy_id')
      .eq('id', id)
      .single()

    if (checkError || !existingDrug) {
      return NextResponse.json(
        { error: 'Drug not found' },
        { status: 404 }
      )
    }

    if (existingDrug.pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Drug does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    // Delete drug
    const { error: deleteError } = await supabase
      .from('drugs')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting drug:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete drug' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Drug deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
