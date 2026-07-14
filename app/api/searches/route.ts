import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type TablesWithRelationships = {
  [TableName in keyof Database['public']['Tables']]:
    Database['public']['Tables'][TableName] extends { Relationships: unknown[] }
      ? Database['public']['Tables'][TableName]
      : Database['public']['Tables'][TableName] & { Relationships: [] }
}

type SearchDatabase = {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: TablesWithRelationships
  }
}

const searchPayloadSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  product_id: z.string().uuid().nullable().optional(),
  results_count: z.number().int().min(0).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
})

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
    const supabase = (await createClient()) as unknown as SupabaseClient<SearchDatabase>

    // Get user if authenticated (optional for searches)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const parsed = searchPayloadSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid search payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { query, product_id, results_count, location } = parsed.data
    let canonicalProductId = typeof product_id === 'string' ? product_id : null

    if (!canonicalProductId) {
      const { data: matches } = await supabase.rpc('match_catalogue_product', {
        search_query: query,
      })
      const bestMatch = Array.isArray(matches) ? matches[0] : null
      if (bestMatch && Number(bestMatch.confidence) >= 0.4) canonicalProductId = bestMatch.id
    }

    // Analytics is de-identified. Patient-readable history lives in a separate owner-only table.
    const aggregatePayload = {
      user_id: null,
      session_id: null,
      query_text: query,
      location: location ?? null,
      metadata: null,
      results_count: results_count ?? null,
      product_id: canonicalProductId,
      interpreted_query: {
        ...interpretQuery(query),
        product_id: canonicalProductId,
      },
    }

    const { error: aggError } = await supabase.from('searches').insert(aggregatePayload)

    if (aggError) {
      console.error('Error logging aggregate search:', aggError)
    }

    // A patient can read their own query history; it is retained separately from analytics.
    if (user) {
      const { error: historyError } = await supabase.from('user_search_history').insert({
        user_id: user.id,
        query_text: query,
        product_id: canonicalProductId,
        results_count: results_count ?? null,
        location: location ?? null,
      })

      if (historyError) {
        console.error('Error logging user search history:', historyError)
        return NextResponse.json(
          { error: 'Failed to save search history' },
          { status: 500 }
        )
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
    const supabase = (await createClient()) as unknown as SupabaseClient<SearchDatabase>

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Only the owner-readable table is exposed to the patient UI.
    const { data: searches, error: fetchError } = await supabase
      .from('user_search_history')
      .select('id, query_text, product_id, results_count, location, searched_at')
      .eq('user_id', user.id)
      .order('searched_at', { ascending: false })
      .limit(50)

    if (fetchError) {
      console.error('Error fetching searches:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch search history' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      (searches ?? [])
        .filter((search) => !search.query_text.startsWith('hash:'))
        .map((search) => ({
          ...search,
          timestamp: search.searched_at,
        }))
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
