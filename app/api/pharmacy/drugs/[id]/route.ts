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

    // Verify inventory row belongs to this pharmacy
    const { data: existingRow, error: checkError } = await supabase
      .from('pharmacy_inventory')
      .select('pharmacy_id')
      .eq('id', id)
      .single()

    if (checkError || !existingRow) {
      return NextResponse.json(
        { error: 'Medication not found' },
        { status: 404 }
      )
    }

    if ((existingRow as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Medication does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    const body = await request.json()

    if (body.price === undefined || body.price === null || Number.isNaN(Number(body.price))) {
      return NextResponse.json({ error: 'Price is required' }, { status: 400 })
    }

    const { data: updatedRow, error: updateError } = await (supabase
      .from('pharmacy_inventory') as any)
      .update({
        price: Number(body.price),
        low_stock_threshold:
          body.low_stock_threshold !== undefined && body.low_stock_threshold !== null
            ? parseInt(body.low_stock_threshold, 10)
            : undefined,
        notes: body.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating medication:', updateError)
      return NextResponse.json(
        { error: 'Failed to update medication' },
        { status: 500 }
      )
    }

    return NextResponse.json(updatedRow)
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

    // Verify inventory row belongs to this pharmacy
    const { data: existingRow, error: checkError } = await supabase
      .from('pharmacy_inventory')
      .select('pharmacy_id')
      .eq('id', id)
      .single()

    if (checkError || !existingRow) {
      return NextResponse.json(
        { error: 'Medication not found' },
        { status: 404 }
      )
    }

    if ((existingRow as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Medication does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    // Deleting the inventory row cascades to its batches and stock_movements
    const { error: deleteError } = await supabase
      .from('pharmacy_inventory')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting medication:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete medication' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Medication deleted successfully' },
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
