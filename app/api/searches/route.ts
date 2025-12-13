import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get user if authenticated (optional for searches)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Parse request body
    const body = await request.json()

    const { query, results_count, location, session_id, metadata } = body

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    // Log search
    const insertPayload: Database['public']['Tables']['searches']['Insert'] = {
      user_id: user?.id ?? null,
      session_id: session_id ?? null,
      query_text: query,
      location: location ?? null,
      metadata: (metadata ?? null) as Database['public']['Tables']['searches']['Insert']['metadata'],
      results_count: results_count ?? null,
    }

    const { error: insertError } = await (supabase
      .from('searches') as any).insert(insertPayload)

    if (insertError) {
      console.error('Error logging search:', insertError)
      return NextResponse.json(
        { error: 'Failed to log search' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

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

    // Fetch user's search history
    const { data: searches, error: fetchError } = await supabase
      .from('searches')
      .select('*')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(50)

    if (fetchError) {
      console.error('Error fetching searches:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch search history' },
        { status: 500 }
      )
    }

    return NextResponse.json(searches)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
