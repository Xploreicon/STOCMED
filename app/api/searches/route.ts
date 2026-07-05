import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

function interpretQuery(query: string) {
  const strengthRegex = /\b\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|ug|capsules|tablets|tabs|s)\b/gi
  const strengthMatch = query.match(strengthRegex)
  const strength = strengthMatch ? strengthMatch[0] : null

  let drugName = query
  if (strengthMatch) {
    drugName = query.replace(strengthRegex, '').trim()
  }
  drugName = drugName.replace(/\s+/g, ' ').trim()

  const categories = [
    'Analgesics', 'Antibiotics', 'Antimalarials', 'Antihypertensives',
    'Diabetes', 'Vitamins', 'Gastrointestinal', 'Respiratory', 'Others'
  ]
  const matchedCategory = categories.find(cat => 
    query.toLowerCase().includes(cat.toLowerCase())
  )

  return {
    raw_query: query,
    parsed: {
      drug_name: drugName || query,
      strength: strength,
      category: matchedCategory || null
    }
  }
}

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

    const normalizedQuery = query.trim().toLowerCase()
    const queryHash = crypto.createHash('sha256').update(normalizedQuery).digest('hex')

    // 1. Log anonymous aggregate record for demand analytics (strictly decoupled from user/session identity)
    const aggregatePayload = {
      user_id: null,
      session_id: null,
      query_text: query,
      location: location ?? null,
      metadata: null,
      results_count: results_count ?? null,
      interpreted_query: interpretQuery(query) as any,
    }

    const { error: aggError } = await (supabase
      .from('searches') as any).insert(aggregatePayload)

    if (aggError) {
      console.error('Error logging aggregate search:', aggError)
    }

    // 2. If user is logged in, log history record with hashed content to prevent re-identification
    if (user) {
      const userPayload = {
        user_id: user.id,
        session_id: session_id ?? null,
        query_text: `hash:${queryHash}`,
        location: location ?? null,
        metadata: (metadata ?? null) as any,
        results_count: results_count ?? null,
        interpreted_query: null, // do not store plaintext parsed info
      }

      const { error: userError } = await (supabase
        .from('searches') as any).insert(userPayload)

      if (userError) {
        console.error('Error logging user search:', userError)
      }
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
