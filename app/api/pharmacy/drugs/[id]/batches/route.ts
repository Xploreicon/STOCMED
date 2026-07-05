import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
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
        { error: 'Pharmacy profile not found.' },
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
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Fetch batches
    const { data: batches, error: fetchError } = await (supabase as any)
      .from('batches')
      .select('*')
      .eq('inventory_id', id)
      .order('expiry_date', { ascending: true })

    if (fetchError) {
      console.error('Error fetching batches:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch batches' },
        { status: 500 }
      )
    }

    return NextResponse.json(batches || [])
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
