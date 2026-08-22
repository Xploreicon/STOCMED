import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { getStructuredRpcFailure } from '@/lib/sp-authorization'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  return pharmacy ? { supabase, pharmacy } : null
}

export async function GET(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'credit_sales')
  if (featureError) return NextResponse.json(featureError, { status: 403 })

  const customerId = request.nextUrl.searchParams.get('customer_id')
  if (customerId) {
    if (!z.string().uuid().safeParse(customerId).success) return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
    const [{ data: customer }, { data: limit }, { data: entries }] = await Promise.all([
      current.supabase.from('customers').select('id,name,phone').eq('id', customerId).eq('pharmacy_id', current.pharmacy.id).is('deleted_at', null).maybeSingle(),
      current.supabase.from('customer_credit_limits').select('credit_limit').eq('customer_id', customerId).eq('pharmacy_id', current.pharmacy.id).maybeSingle(),
      current.supabase.from('customer_credit_ledger').select('id,entry_type,amount,balance_after,notes,sale_id,created_at').eq('customer_id', customerId).eq('pharmacy_id', current.pharmacy.id).order('created_at', { ascending: false }).limit(200),
    ])
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    const balance = (entries ?? []).reduce((sum: number, entry: any) => sum + Number(entry.amount), 0)
    const creditLimit = Number(limit?.credit_limit ?? 0)
    return NextResponse.json({ customer, credit_limit: creditLimit, balance, available_credit: Math.max(creditLimit - balance, 0), entries: entries ?? [] })
  }

  const from = request.nextUrl.searchParams.get('from') || new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }
  const { data, error } = await current.supabase.rpc('get_customer_credit_report', { p_from: from, p_to: to })
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ report: data })
}

export async function PUT(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'credit_sales')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const parsed = z.object({ customer_id: z.string().uuid(), credit_limit: z.coerce.number().nonnegative().max(100_000_000) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid customer and credit limit' }, { status: 400 })
  const { data, error } = await current.supabase.rpc('set_customer_credit_limit', {
    p_customer_id: parsed.data.customer_id,
    p_credit_limit: parsed.data.credit_limit,
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const failure = getStructuredRpcFailure(data)
  return failure
    ? NextResponse.json(failure, { status: failure.code === 'SP_AUTH_REQUIRED' ? 403 : 409 })
    : NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'credit_sales')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const parsed = z.object({
    customer_id: z.string().uuid(),
    entry_type: z.enum(['payment', 'write_off']),
    amount: z.coerce.number().positive().max(100_000_000),
    notes: z.string().trim().max(500).optional().default(''),
    request_key: z.string().trim().min(8).max(200).optional(),
  }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check the payment details' }, { status: 400 })
  const { data, error } = await current.supabase.rpc('record_customer_credit_adjustment', {
    p_customer_id: parsed.data.customer_id,
    p_entry_type: parsed.data.entry_type,
    p_amount: parsed.data.amount,
    p_notes: parsed.data.notes,
    p_request_key: parsed.data.request_key || crypto.randomUUID(),
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const failure = getStructuredRpcFailure(data)
  return failure
    ? NextResponse.json(failure, { status: failure.code === 'SP_AUTH_REQUIRED' ? 403 : 409 })
    : NextResponse.json(data, { status: 201 })
}
