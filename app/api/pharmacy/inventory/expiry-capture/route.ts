import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { expiryCaptureSchema } from '@/lib/validation/reporting'
import { getStructuredRpcFailure } from '@/lib/sp-authorization'

export const dynamic = 'force-dynamic'

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
  const { data, error } = await current.supabase.from('quickbooks_import_staging').select(`
    id,product_id,source_name,sku,quantity,unit_cost,retail_price,created_at,
    products(id,generic_name,brand_name,strength,dosage_form,pack_size,barcode)
  `).eq('pharmacy_id', current.pharmacy.id).eq('status', 'pending').order('created_at')
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const current = await context()
  if ('error' in current) return NextResponse.json({ error: current.error }, { status: current.status })
  const parsed = expiryCaptureSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { data, error } = await current.supabase.rpc('capture_quickbooks_expiry', {
    p_pharmacy_id: current.pharmacy.id,
    p_staging_id: parsed.data.staging_id,
    p_batch_number: parsed.data.batch_number,
    p_expiry_date: parsed.data.expiry_date,
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })

  const rpcFailure = getStructuredRpcFailure(data, 'Expiry capture was rejected')
  if (rpcFailure) {
    return NextResponse.json(
      { error: rpcFailure.error, ...(rpcFailure.code ? { code: rpcFailure.code } : {}) },
      { status: rpcFailure.code === 'SP_AUTH_REQUIRED' ? 403 : 409 },
    )
  }

  return NextResponse.json(data, { status: 201 })
}
