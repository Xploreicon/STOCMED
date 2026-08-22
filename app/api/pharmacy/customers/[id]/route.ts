import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { customerInputSchema } from '@/lib/validation/customers'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  return pharmacy ? { supabase, pharmacy } : null
}

function validId(value: string) {
  return z.string().uuid().safeParse(value).success
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'customers')
  if (featureError) return NextResponse.json(featureError, { status: 403 })

  const [{ data: customer, error }, { data: sales }] = await Promise.all([
    current.supabase.from('customers')
      .select('id,name,phone,email,consent_whatsapp,consent_sms,consent_email,notes,created_at,updated_at')
      .eq('id', params.id).eq('pharmacy_id', current.pharmacy.id).is('deleted_at', null).maybeSingle(),
    current.supabase.from('sales')
      .select('id,total,discount,payment_method,status,created_at')
      .eq('customer_id', params.id).eq('pharmacy_id', current.pharmacy.id)
      .order('created_at', { ascending: false }).limit(100),
  ])
  if (error || !customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json({ customer, sales: sales ?? [] })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'customers')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const body = customerInputSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || 'Check the customer details' }, { status: 400 })
  const { data, error } = await current.supabase.rpc('save_authenticated_customer', {
    p_customer: { id: params.id, ...body.data },
  })
  return error
    ? NextResponse.json({ error: error.message }, { status: 409 })
    : NextResponse.json({ customer: data })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'customers')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { data, error } = await current.supabase.rpc('delete_authenticated_customer', { p_customer_id: params.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return data
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Customer not found' }, { status: 404 })
}
