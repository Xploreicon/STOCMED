import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { lagosDateKey, queueNotification } from '@/lib/notifications/events'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const { data: preferences, error } = await (admin.from('pharmacy_notification_preferences') as any)
    .select('*,pharmacies(user_id,phone,pharmacy_name)')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const day = lagosDateKey()
  const from = new Date(`${day}T00:00:00+01:00`)
  const to = new Date(from.getTime() + 24 * 60 * 60_000)
  let generated = 0

  for (const preference of preferences || []) {
    const { data: feature } = await (admin.from('pharmacy_features') as any)
      .select('is_enabled')
      .eq('pharmacy_id', preference.pharmacy_id)
      .eq('feature_key', 'notifications')
      .maybeSingle()
    if (feature?.is_enabled !== true) continue

    const { data: sales, error: salesError } = await (admin.from('sales') as any)
      .select('total')
      .eq('pharmacy_id', preference.pharmacy_id)
      .eq('status', 'completed')
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())
    if (salesError) continue

    const pharmacy = Array.isArray(preference.pharmacies) ? preference.pharmacies[0] : preference.pharmacies
    if (!pharmacy?.user_id) continue
    const count = sales?.length ?? 0
    const total = (sales || []).reduce((sum: number, sale: any) => sum + Number(sale.total || 0), 0)
    const average = count ? total / count : 0
    const money = (value: number) => `₦${Math.round(value).toLocaleString('en-NG')}`
    try {
      await queueNotification({
        eventKey: `daily-summary:${preference.pharmacy_id}:${day}`,
        recipientType: 'pharmacist',
        recipientId: pharmacy.user_id,
        pharmacyId: preference.pharmacy_id,
        type: 'daily_summary',
        title: `Today: ${money(total)} from ${count} sale${count === 1 ? '' : 's'}`,
        body: count ? `Your average sale was ${money(average)}.` : 'No completed sales were recorded today.',
        data: { date: day, total, count, average, href: `/pharmacy/reports?from=${day}&to=${day}` },
        choices: {
          email: preference.daily_summary_email_opt_in,
          sms: preference.daily_summary_sms_opt_in,
        },
        email: preference.owner_email,
        phone: preference.owner_phone || pharmacy.phone,
        smsBody: `StocMed ${day}: ${money(total)} from ${count} sale(s). Average ${money(average)}.`,
        dailyEmailCap: preference.daily_email_cap,
        dailySmsCap: preference.daily_sms_cap,
      })
      generated += 1
    } catch {
      // A summary failure is isolated to this pharmacy and retried by the next run.
    }
  }

  return NextResponse.json({ considered: preferences?.length ?? 0, generated, date: day })
}
