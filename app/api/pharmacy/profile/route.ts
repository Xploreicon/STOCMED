import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord, PHARMACY_PROFILE_SELECT } from '@/lib/pharmacy'
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

    if (typeof body.reservations_enabled === 'boolean') {
      const { data: reservationProfile, error: reservationError } = await (supabase.rpc as any)(
        'set_pharmacy_reservations_enabled_client',
        { p_enabled: body.reservations_enabled }
      )

      if (reservationError) {
        return NextResponse.json({ error: reservationError.message }, { status: 409 })
      }

      const hasOtherProfileFields = [
        'pharmacy_name', 'address', 'city', 'state', 'phone',
        'latitude', 'longitude', 'logo_url', 'is_active',
      ].some((field) => Object.prototype.hasOwnProperty.call(body, field))

      if (!hasOtherProfileFields) {
        return NextResponse.json(reservationProfile)
      }
    }

    // Update pharmacy details
    const updates = {
      ...(typeof body.pharmacy_name === 'string' ? { pharmacy_name: body.pharmacy_name } : {}),
      ...(typeof body.address === 'string' ? { address: body.address } : {}),
      ...(typeof body.city === 'string' ? { city: body.city } : {}),
      ...(typeof body.state === 'string' ? { state: body.state } : {}),
      ...(typeof body.phone === 'string' ? { phone: body.phone } : {}),
      ...(typeof body.latitude === 'number' || body.latitude === null ? { latitude: body.latitude } : {}),
      ...(typeof body.longitude === 'number' || body.longitude === null ? { longitude: body.longitude } : {}),
      ...(typeof body.logo_url === 'string' || body.logo_url === null ? { logo_url: body.logo_url } : {}),
      ...(typeof body.is_active === 'boolean' ? { is_active: body.is_active } : {}),
    }

    const { data: updatedPharmacy, error } = await (supabase
      .from('pharmacies') as any)
      .update(updates)
      .eq('id', pharmacyRecord.id)
      .select(PHARMACY_PROFILE_SELECT)
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
