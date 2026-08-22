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

export async function POST(request: NextRequest) {
  const parsed = z.object({ staff_id: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid PIN' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'staff_accounts')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { data, error } = await current.supabase.rpc('authenticate_pharmacy_staff', { p_staff_id: parsed.data.staff_id, p_pin: parsed.data.pin })
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  const status = data?.success === false ? (data.code === 'STAFF_PIN_LOCKED' ? 423 : 403) : 200
  return NextResponse.json(data, { status })
}

export async function PUT(request: NextRequest) {
  const parsed = z.object({ token: z.string().min(32), permission: z.enum(['can_sell','can_adjust_stock','can_view_reports','can_change_prices','can_refund']) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid staff session' }, { status: 400 })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await current.supabase.rpc('authorize_staff_permission', { p_session_token: parsed.data.token, p_permission: parsed.data.permission })
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json(data, { status: data?.allowed ? 200 : 403 })
}

export async function DELETE(request: NextRequest) {
  const parsed = z.object({ token: z.string().min(32) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: true })
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await current.supabase.rpc('revoke_staff_session', { p_session_token: parsed.data.token })
  return NextResponse.json({ success: true })
}
