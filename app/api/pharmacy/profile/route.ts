import { createClient } from '@/lib/supabase/server'
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

    // Get pharmacy_id from user metadata
    const pharmacyId = user.user_metadata?.pharmacy_id

    if (!pharmacyId) {
      return NextResponse.json(
        { error: 'Pharmacy ID not found in user profile' },
        { status: 404 }
      )
    }

    // Fetch pharmacy details
    const { data: pharmacy, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('id', pharmacyId)
      .single()

    if (error) {
      console.error('Error fetching pharmacy:', error)
      return NextResponse.json(
        { error: 'Failed to fetch pharmacy details' },
        { status: 500 }
      )
    }

    return NextResponse.json(pharmacy)
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

    // Get pharmacy_id from user metadata
    const pharmacyId = user.user_metadata?.pharmacy_id

    if (!pharmacyId) {
      return NextResponse.json(
        { error: 'Pharmacy ID not found in user profile' },
        { status: 404 }
      )
    }

    const body = await request.json()

    // Update pharmacy details
    const { data: pharmacy, error } = await supabase
      .from('pharmacies')
      .update({
        pharmacy_name: body.pharmacy_name,
        address: body.address,
        city: body.city,
        state: body.state,
        phone: body.phone,
        license_number: body.license_number,
        latitude: body.latitude,
        longitude: body.longitude,
      })
      .eq('id', pharmacyId)
      .select()
      .single()

    if (error) {
      console.error('Error updating pharmacy:', error)
      return NextResponse.json(
        { error: 'Failed to update pharmacy details' },
        { status: 500 }
      )
    }

    return NextResponse.json(pharmacy)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
