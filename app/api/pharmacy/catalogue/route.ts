import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)

    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''

    let builder = supabase
      .from('products')
      .select('id, generic_name, brand_name, strength, dosage_form, pack_size, manufacturer')
      .order('generic_name', { ascending: true })
      .limit(20)

    if (query) {
      builder = builder.or(`generic_name.ilike.%${query}%,brand_name.ilike.%${query}%`)
    }

    const { data: products, error } = await builder

    if (error) {
      console.error('Error searching catalogue:', error)
      return NextResponse.json({ error: 'Failed to search catalogue' }, { status: 500 })
    }

    return NextResponse.json({ products })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
