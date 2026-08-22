import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { getStructuredRpcFailure } from '@/lib/sp-authorization'
import { staffInputSchema } from '@/lib/validation/staff'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  return pharmacy ? { supabase, pharmacy } : null
}

export async function GET() {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { data, error } = await current.supabase.from('pharmacy_staff')
    .select('id,name,role,is_active,permissions,pin_locked_until,last_authenticated_at,created_at,updated_at')
    .eq('pharmacy_id', current.pharmacy.id).order('is_active', { ascending: false }).order('name')
  return error ? NextResponse.json({ error: 'Could not load staff' }, { status: 500 }) : NextResponse.json({ staff: data ?? [] })
}

export async function POST(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const parsed = staffInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !parsed.data.pin) return NextResponse.json({ error: 'Enter staff details and a 4 to 6 digit PIN' }, { status: 400 })
  const { pin, ...staff } = parsed.data
  const { data, error } = await current.supabase.rpc('save_authenticated_staff', {
    p_staff: staff, p_pin: pin, p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const failure = getStructuredRpcFailure(data)
  return failure ? NextResponse.json(failure, { status: 403 }) : NextResponse.json(data, { status: 201 })
}
