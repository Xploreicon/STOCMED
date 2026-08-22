import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 7
const MAX_RESULTS = 8

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

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
    const featureError = await requirePharmacyFeature(supabase as any, pharmacy.id, 'unmet_demand_widget')
    if (featureError) return NextResponse.json(featureError, { status: 403 })

    const { data: inventoryRows } = await supabase
      .from('pharmacy_inventory')
      .select('products(generic_name, brand_name)')
      .eq('pharmacy_id', pharmacy.id)
      .eq('item_type', 'medicine')

    const stockedTerms = new Set(
      (inventoryRows ?? []).flatMap((row: any) => {
        const p = row.products
        if (!p) return []
        return [p.generic_name, p.brand_name].filter(Boolean).map((t: string) => normalize(t))
      })
    )

    const admin = getAdminClient()
    if (!admin) {
      // No service-role key configured in this environment — return an empty
      // (rather than broken) widget instead of erroring the whole page out.
      return NextResponse.json({ demand: [] })
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

    let searchQuery = admin
      .from('searches')
      .select('query_text, location, timestamp')
      .gte('timestamp', since)
      .limit(2000)

    if (pharmacy.city || pharmacy.state) {
      const locationFilters = [pharmacy.city, pharmacy.state]
        .filter(Boolean)
        .map((loc) => `location.ilike.%${loc}%`)
        .join(',')
      searchQuery = searchQuery.or(`${locationFilters},location.is.null`)
    }

    const { data: searches, error: searchError } = await searchQuery

    if (searchError) {
      console.error('Error fetching searches for unmet demand:', searchError)
      return NextResponse.json({ error: 'Failed to compute unmet demand' }, { status: 500 })
    }

    const counts = new Map<string, { label: string; count: number }>()
    for (const s of searches ?? []) {
      const key = normalize((s as any).query_text)
      if (!key || stockedTerms.has(key)) continue
      const existing = counts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(key, { label: (s as any).query_text.trim(), count: 1 })
      }
    }

    const demand = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_RESULTS)
      .map((d, i) => ({ rank: i + 1, drug: d.label, searches: d.count }))

    return NextResponse.json({ demand })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
