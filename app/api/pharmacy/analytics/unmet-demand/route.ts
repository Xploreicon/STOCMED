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
        { error: 'Pharmacy profile not found.' },
        { status: 404 }
      )
    }

    // Run query using direct pg client or RPC or raw query.
    // Wait, since supabase-js does not support raw SQL easily unless we define an RPC function,
    // let's check: can we execute raw SQL query using postgres client, or should we create a Postgres function?
    // Defining an RPC function in the database makes this incredibly clean and keeps the Next.js API simple!
    // Let's create an RPC function `get_unmet_demand(p_pharmacy_id UUID, p_lat NUMERIC, p_lng NUMERIC, p_city TEXT)` via migration!
    // Yes! That is much cleaner than trying to initialize a pg connection inside a Next.js route, and guarantees RLS and security.
    
    // Let's check: does the RPC already exist? No, we will add it.
    // Let's call the RPC function we will deploy:
    const { data: unmetDemand, error } = await (supabase.rpc as any)('get_unmet_demand', {
      p_pharmacy_id: pharmacy.id,
      p_lat: pharmacy.latitude ? Number(pharmacy.latitude) : null,
      p_lng: pharmacy.longitude ? Number(pharmacy.longitude) : null,
      p_city: pharmacy.city || null
    })

    if (error) {
      console.error('Error fetching unmet demand RPC:', error)
      return NextResponse.json(
        { error: 'Failed to compute unmet demand' },
        { status: 500 }
      )
    }

    return NextResponse.json(unmetDemand || [])
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
