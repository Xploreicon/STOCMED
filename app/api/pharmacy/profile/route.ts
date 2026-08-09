import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'

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
    const hasLatitude = Object.prototype.hasOwnProperty.call(body, 'latitude')
    const hasLongitude = Object.prototype.hasOwnProperty.call(body, 'longitude')
    if (hasLatitude !== hasLongitude) {
      return NextResponse.json({ error: 'Latitude and longitude must be updated together' }, { status: 400 })
    }
    if (
      (hasLatitude && body.latitude !== null && (
        typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90
      ))
      || (hasLongitude && body.longitude !== null && (
        typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180
      ))
    ) {
      return NextResponse.json({ error: 'Invalid pharmacy coordinates' }, { status: 400 })
    }
    for (const field of ['opening_time', 'closing_time'] as const) {
      if (
        Object.prototype.hasOwnProperty.call(body, field)
        && body[field] !== null
        && (typeof body[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field]))
      ) {
        return NextResponse.json({ error: `${field.replace('_', ' ')} must be a valid 24-hour time` }, { status: 400 })
      }
    }
    if (body.opening_time && body.closing_time && body.opening_time === body.closing_time) {
      return NextResponse.json({ error: 'Opening and closing times must be different' }, { status: 400 })
    }

    if (typeof body.reservations_enabled === 'boolean') {
      return NextResponse.json(
        { error: 'Manage reservations from Settings → Features.', code: 'FEATURE_SETTINGS_REQUIRED' },
        { status: 409 },
      )
    }

    // The RPC allowlists these fields again and resolves the tenant from auth.uid().
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
      ...(body.opening_time === null
        ? { opening_time: null }
        : typeof body.opening_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.opening_time)
        ? { opening_time: body.opening_time } : {}),
      ...(body.closing_time === null
        ? { closing_time: null }
        : typeof body.closing_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.closing_time)
        ? { closing_time: body.closing_time } : {}),
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No supported pharmacy profile fields were provided' }, { status: 400 })
    }

    const { data: updatedPharmacy, error } = await (supabase.rpc as any)(
      'update_authenticated_pharmacy_profile',
      {
        p_patch: updates,
        p_sp_token: request.headers.get('x-sp-authorization'),
      },
    )

    if (error) {
      console.error('Error updating pharmacy:', error)
      return NextResponse.json(
        { error: 'Failed to update pharmacy details' },
        { status: 500 }
      )
    }

    if (updatedPharmacy?.success === false) {
      if (updatedPharmacy.code === 'SP_AUTH_REQUIRED') {
        return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      }
      return NextResponse.json(
        { error: updatedPharmacy.error || 'Failed to update pharmacy details', code: updatedPharmacy.code },
        { status: 409 },
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
