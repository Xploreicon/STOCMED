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

    const pharmacyRecord = await ensurePharmacyRecord(supabase, user)

    if (!pharmacyRecord) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    return NextResponse.json(pharmacyRecord)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
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

    const pharmacyRecord = await ensurePharmacyRecord(supabase, user)

    if (!pharmacyRecord) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    const body = await request.json()

    // Update pharmacy details
    const { data: updatedPharmacy, error } = await (supabase
      .from('pharmacies') as any)
      .update({
        pharmacy_name: body.pharmacy_name,
        address: body.address,
        city: body.city,
        state: body.state,
        phone: body.phone,
        license_number: body.license_number,
        latitude: body.latitude,
        longitude: body.longitude,
        logo_url: body.logo_url,
        is_active: typeof body.is_active === 'boolean' ? body.is_active : undefined,
      })
      .eq('id', pharmacyRecord.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating pharmacy:', error)
      return NextResponse.json(
        { error: 'Failed to update pharmacy details' },
        { status: 500 }
      )
    }

    return NextResponse.json(updatedPharmacy)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
