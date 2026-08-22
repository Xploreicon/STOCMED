import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { customerInputSchema } from '@/lib/validation/customers'

export const dynamic = 'force-dynamic'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return null
  return { supabase, pharmacy }
}

export async function GET(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'customers')
  if (featureError) return NextResponse.json(featureError, { status: 403 })

  const search = (request.nextUrl.searchParams.get('q') || '').trim().replace(/[%_,()]/g, '')
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 50), 1), 100)
  let query = current.supabase
    .from('customers')
    .select('id,name,phone,email,consent_whatsapp,consent_sms,consent_email,notes,created_at,updated_at')
    .eq('pharmacy_id', current.pharmacy.id)
    .is('deleted_at', null)
    .order('name')
    .limit(limit)
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
  const { data, error } = await query
  return error
    ? NextResponse.json({ error: 'Could not load customers' }, { status: 500 })
    : NextResponse.json({ customers: data ?? [] })
}

export async function POST(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'customers')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const body = customerInputSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || 'Check the customer details' }, { status: 400 })
  const { data, error } = await current.supabase.rpc('save_authenticated_customer', { p_customer: body.data })
  return error
    ? NextResponse.json({ error: error.message }, { status: 409 })
    : NextResponse.json({ customer: data }, { status: 201 })
}
