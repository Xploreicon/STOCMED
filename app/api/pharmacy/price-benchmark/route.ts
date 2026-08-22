import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  return pharmacy ? { supabase, pharmacy } : null
}

export async function GET(request: NextRequest) {
  const inventoryId = request.nextUrl.searchParams.get('inventory_id')
  if (!z.string().uuid().safeParse(inventoryId).success) return NextResponse.json({ error: 'Choose a valid inventory item' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase,current.pharmacy.id,'price_benchmark')
  if (featureError) return NextResponse.json(featureError,{ status: 403 })
  const { data,error } = await current.supabase.rpc('get_local_price_benchmark',{ p_inventory_id: inventoryId })
  return error ? NextResponse.json({ error: error.message },{ status: 409 }) : NextResponse.json({ benchmark: data })
}

export async function PUT(request: NextRequest) {
  const parsed = z.object({ radius_km: z.coerce.number().min(1).max(50) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a radius between 1 and 50 kilometres' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase,current.pharmacy.id,'price_benchmark')
  if (featureError) return NextResponse.json(featureError,{ status: 403 })
  const { data,error } = await current.supabase.rpc('set_price_benchmark_radius',{ p_radius_km: parsed.data.radius_km })
  return error ? NextResponse.json({ error: error.message },{ status: 409 }) : NextResponse.json(data)
}
