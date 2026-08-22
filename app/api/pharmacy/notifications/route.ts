import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { normalizeNigerianPhone } from '@/lib/notifications/phone'

const schema = z.object({
  owner_phone: z.string().min(7).max(32),
  owner_email: z.string().email().max(320),
  reservation_sms_opt_in: z.boolean(),
  stock_digest_sms_opt_in: z.boolean(),
  daily_sms_cap: z.number().int().min(1).max(100),
  low_stock_email_opt_in: z.boolean(),
  low_stock_sms_opt_in: z.boolean(),
  expiry_email_opt_in: z.boolean(),
  expiry_sms_opt_in: z.boolean(),
  daily_summary_email_opt_in: z.boolean(),
  daily_summary_sms_opt_in: z.boolean(),
  daily_email_cap: z.number().int().min(1).max(100),
})

async function context() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const pharmacy = await ensurePharmacyRecord(supabase as any, user)
  return pharmacy ? { supabase: supabase as any, pharmacy, user } : null
}

export async function GET() {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'notifications')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const { data, error } = await current.supabase
    .from('pharmacy_notification_preferences')
    .select('owner_phone,owner_email,reservation_sms_opt_in,stock_digest_sms_opt_in,daily_sms_cap,low_stock_email_opt_in,low_stock_sms_opt_in,expiry_email_opt_in,expiry_sms_opt_in,daily_summary_email_opt_in,daily_summary_sms_opt_in,daily_email_cap')
    .eq('pharmacy_id', current.pharmacy.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not load notification settings' }, { status: 500 })
  return NextResponse.json({
    preferences: data || {
      owner_phone: current.pharmacy.phone,
      owner_email: current.user.email ?? '',
      reservation_sms_opt_in: false,
      stock_digest_sms_opt_in: false,
      daily_sms_cap: 10,
      low_stock_email_opt_in: false,
      low_stock_sms_opt_in: false,
      expiry_email_opt_in: false,
      expiry_sms_opt_in: false,
      daily_summary_email_opt_in: false,
      daily_summary_sms_opt_in: false,
      daily_email_cap: 20,
    },
  })
}

export async function PUT(request: NextRequest) {
  const current = await context()
  if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const featureError = await requirePharmacyFeature(current.supabase, current.pharmacy.id, 'notifications')
  if (featureError) return NextResponse.json(featureError, { status: 403 })
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Check the notification settings' }, { status: 400 })

  let phone: string
  try {
    phone = normalizeNigerianPhone(body.data.owner_phone)
  } catch {
    return NextResponse.json({ error: 'Enter a valid Nigerian mobile number' }, { status: 400 })
  }
  const { data, error } = await current.supabase.rpc('set_authenticated_pharmacy_notification_preferences', {
    p_preferences: { ...body.data, owner_phone: phone },
  })
  if (error) return NextResponse.json({ error: 'Could not save notification settings' }, { status: 500 })
  return NextResponse.json({ preferences: data })
}
