import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
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

    // Update pharmacy_inventory
    const { error: updateError } = await (supabase as any)
      .from('pharmacy_inventory')
      .update({
        price: body.price !== undefined ? Number(body.price) : undefined,
        low_stock_threshold: body.low_stock_threshold !== undefined ? Number(body.low_stock_threshold) : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      console.error('Error updating inventory:', updateError)
      return NextResponse.json(
        { error: 'Failed to update drug' },
        { status: 500 }
      )
    }

    // Update product image_url if provided
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

    // Fetch and return the updated view record to keep UI happy
    const { data: drug, error: fetchError } = await (supabase as any)
      .from('drugs')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError) {
      console.error('Error fetching updated drug view:', fetchError)
      return NextResponse.json(
        { error: 'Failed to retrieve updated drug profile' },
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
      .select('pharmacy_id')
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

    // Delete drug
    const { error: deleteError } = await (supabase as any)
      .from('pharmacy_inventory')
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
