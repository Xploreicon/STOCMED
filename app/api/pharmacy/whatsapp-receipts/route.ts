import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'

export async function POST(request: NextRequest) {
  const parsed = z.object({ sale_id: z.string().uuid() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid receipt is required' }, { status: 400 })
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const featureError = await requirePharmacyFeature(supabase, pharmacy.id, 'whatsapp_receipts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { data, error } = await supabase.rpc('log_whatsapp_receipt_share', { p_sale_id: parsed.data.sale_id })
  return error
    ? NextResponse.json({ error: error.message }, { status: 409 })
    : NextResponse.json(data)
}
