import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Drug ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: drug, error } = await supabase
      .from('drugs')
      .select(`
        *,
        pharmacies:pharmacy_id (
          id,
          pharmacy_name,
          address,
          city,
          state,
          phone,
          latitude,
          longitude,
          is_verified
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Drug not found' },
          { status: 404 }
        )
      }
      console.error('Error fetching drug:', error)
      return NextResponse.json(
        { error: 'Failed to fetch drug' },
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
