import { NextRequest, NextResponse } from 'next/server'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'

const schema = z.object({
  unitName: z.string().trim().min(2).max(80),
  unitsPer: z.coerce.number().int().min(2).max(1_000_000),
  price: z.coerce.number().positive(),
  barcode: z.string().trim().min(4).max(64).optional().or(z.literal('')),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const featureError = await requirePharmacyFeature(supabase, pharmacy.id, 'packs_and_units')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { id } = await params
  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { data: inventory } = await supabase.from('pharmacy_inventory')
    .select('id').eq('id', id).eq('pharmacy_id', pharmacy.id).maybeSingle()
  if (!inventory) return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
  const { data, error } = await supabase.rpc('create_inventory_selling_unit', {
    p_inventory_id: id,
    p_unit_name: parsed.data.unitName,
    p_units_per: parsed.data.unitsPer,
    p_price: parsed.data.price,
    p_barcode: parsed.data.barcode || null,
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  if (data?.success === false) {
    if (data.code === 'SP_AUTH_REQUIRED') return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
    return NextResponse.json(
      { error: data.error || 'Could not add the selling unit', code: data.code },
      { status: data.code === 'NOT_FOUND' ? 404 : 409 },
    )
  }
  return NextResponse.json({ sellingUnit: data?.selling_unit }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const featureError = await requirePharmacyFeature(supabase, pharmacy.id, 'packs_and_units')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { id } = await params
  const sellingUnitId = request.nextUrl.searchParams.get('sellingUnitId')
  if (!sellingUnitId) return NextResponse.json({ error: 'Selling unit is required' }, { status: 400 })
  const { data: inventory } = await supabase.from('pharmacy_inventory')
    .select('id').eq('id', id).eq('pharmacy_id', pharmacy.id).maybeSingle()
  if (!inventory) return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
  const { data, error } = await supabase.rpc('remove_inventory_selling_unit', {
    p_inventory_id: id,
    p_selling_unit_id: sellingUnitId,
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  if (data?.success === false) {
    if (data.code === 'SP_AUTH_REQUIRED') return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
    return NextResponse.json(
      { error: data.error || 'Could not remove the selling unit', code: data.code },
      { status: data.code === 'NOT_FOUND' ? 404 : 409 },
    )
  }
  return NextResponse.json({ success: true })
}
