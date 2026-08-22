import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
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

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) return NextResponse.json({ error: 'Invalid staff member' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const parsed = staffInputSchema.omit({ pin: true }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check the staff details' }, { status: 400 })
  const { data, error } = await current.supabase.rpc('save_authenticated_staff', {
    p_staff: { id: params.id, ...parsed.data }, p_pin: null, p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const failure = getStructuredRpcFailure(data)
  return failure ? NextResponse.json(failure, { status: 403 }) : NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) return NextResponse.json({ error: 'Invalid staff member' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const parsed = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('set_active'), is_active: z.boolean() }),
    z.object({ operation: z.literal('reset_pin'), pin: z.string().regex(/^\d{4,6}$/) }),
  ]).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a valid staff action' }, { status: 400 })
  const result = parsed.data.operation === 'set_active'
    ? await current.supabase.rpc('set_authenticated_staff_active', { p_staff_id: params.id, p_is_active: parsed.data.is_active, p_sp_token: request.headers.get('x-sp-authorization') })
    : await current.supabase.rpc('reset_authenticated_staff_pin', { p_staff_id: params.id, p_new_pin: parsed.data.pin, p_sp_token: request.headers.get('x-sp-authorization') })
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 })
  const failure = getStructuredRpcFailure(result.data)
  return failure ? NextResponse.json(failure, { status: 403 }) : NextResponse.json(result.data)
}
