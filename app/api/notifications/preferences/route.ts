import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  product_email_opt_in: z.boolean(),
  refill_email_opt_in: z.boolean(),
  reminder_sms_opt_in: z.boolean(),
  patient_email_consent: z.boolean(),
  patient_sms_consent: z.boolean(),
  patient_push_consent: z.boolean(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await (supabase.from('notification_preferences') as any)
    .select('product_email_opt_in,refill_email_opt_in,reminder_sms_opt_in,patient_email_consent,patient_sms_consent,patient_push_consent')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not load notification preferences' }, { status: 500 })
  return NextResponse.json({
    preferences: data || {
      product_email_opt_in: false,
      refill_email_opt_in: false,
      reminder_sms_opt_in: false,
      patient_email_consent: false,
      patient_sms_consent: false,
      patient_push_consent: false,
    },
  })
}

export async function PUT(request: NextRequest) {
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid notification preferences' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await (supabase as any).rpc('set_authenticated_notification_preferences', {
    p_preferences: body.data,
  })
  if (error) return NextResponse.json({ error: 'Could not save notification preferences' }, { status: 500 })
  return NextResponse.json({ preferences: data })
}
