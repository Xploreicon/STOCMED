import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Parse request body
    const body = await request.json()
    const { drug_id, pharmacy_id } = body

    if (!drug_id) {
      return NextResponse.json(
        { error: 'drug_id is required' },
        { status: 400 }
      )
    }

    // Note: This assumes a clicked_result or metadata field exists in searches table
    // The database schema should be updated to include this field
    const { data: search, error: updateError } = await (supabase
      .from('searches') as any)
      .update({
        // Using metadata field (JSON) to store click information
        // If schema has a specific clicked_result field, use that instead
        metadata: {
          clicked_drug_id: drug_id,
          clicked_pharmacy_id: pharmacy_id,
          clicked_at: new Date().toISOString(),
        },
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating search click:', updateError)
      return NextResponse.json(
        { error: 'Failed to log click' },
        { status: 500 }
      )
    }

    return NextResponse.json(search)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
