import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { draftReorderSchema } from '@/lib/validation/reporting'

export const dynamic = 'force-dynamic'

type Suggestion = {
  product_id: string
  suggested_quantity: number
  supplier_id: string | null
  unit_cost: number
}

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 } as const
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return { error: 'Pharmacy profile not found', status: 404 } as const
  return { supabase, pharmacy } as const
}

export async function GET() {
  const current = await context()
  if ('error' in current) return NextResponse.json({ error: current.error }, { status: current.status })

  const { data, error } = await current.supabase.rpc('get_reorder_suggestions', {
    p_pharmacy_id: current.pharmacy.id,
    p_limit: 8,
  })
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ suggestions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const current = await context()
  if ('error' in current) return NextResponse.json({ error: current.error }, { status: current.status })

  const parsed = draftReorderSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid product is required' }, { status: 400 })

  const suggestionResult = await current.supabase.rpc('get_reorder_suggestions', {
    p_pharmacy_id: current.pharmacy.id,
    p_limit: 25,
  })
  if (suggestionResult.error) return NextResponse.json({ error: suggestionResult.error.message }, { status: 500 })

  const suggestion = (suggestionResult.data as Suggestion[] | null)?.find(
    item => item.product_id === parsed.data.product_id
  )
  if (!suggestion) return NextResponse.json({ error: 'This product is no longer due for reorder' }, { status: 409 })
  if (!suggestion.supplier_id) {
    return NextResponse.json({ error: 'Receive this product from a supplier once before auto-drafting a PO' }, { status: 409 })
  }

  const { data, error } = await current.supabase.rpc('create_purchase_order', {
    p_pharmacy_id: current.pharmacy.id,
    p_supplier_id: suggestion.supplier_id,
    p_expected_date: null,
    p_notes: 'Smart reorder draft from sales velocity and unmet demand',
    p_items: [{
      product_id: suggestion.product_id,
      quantity_ordered: suggestion.suggested_quantity,
      unit_cost: suggestion.unit_cost,
    }],
  })

  return error
    ? NextResponse.json({ error: error.message }, { status: 409 })
    : NextResponse.json({ purchase_order_id: data }, { status: 201 })
}
