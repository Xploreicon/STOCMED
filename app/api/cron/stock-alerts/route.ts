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

  const today = lagosDateKey()
  const expiryCutoff = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10)
  let generated = 0
  for (const preference of preferences || []) {
    const { data: feature } = await (admin.from('pharmacy_features') as any)
      .select('is_enabled')
      .eq('pharmacy_id', preference.pharmacy_id)
      .eq('feature_key', 'notifications')
      .maybeSingle()
    if (feature?.is_enabled !== true) continue

    const [{ data: inventoryRows }, { count: expiring }] = await Promise.all([
      (admin.from('pharmacy_inventory') as any)
        .select('id,quantity_in_stock,low_stock_threshold')
        .eq('pharmacy_id', preference.pharmacy_id)
        .is('deleted_at', null),
      (admin.from('batches') as any)
        .select('id,pharmacy_inventory!inner(pharmacy_id)', { count: 'exact', head: true })
        .eq('pharmacy_inventory.pharmacy_id', preference.pharmacy_id)
        .gte('expiry_date', today)
        .lte('expiry_date', expiryCutoff),
    ])
    const lowStock = (inventoryRows || []).filter((row: any) =>
      Number(row.quantity_in_stock) <= Number(row.low_stock_threshold),
    ).length
    const pharmacy = Array.isArray(preference.pharmacies) ? preference.pharmacies[0] : preference.pharmacies
    if (!pharmacy?.user_id) continue

    const jobs: Array<Promise<unknown>> = []
    if (lowStock > 0) {
      jobs.push(queueNotification({
        eventKey: `low-stock:${preference.pharmacy_id}:${today}`,
        recipientType: 'pharmacist',
        recipientId: pharmacy.user_id,
        pharmacyId: preference.pharmacy_id,
        type: 'low_stock',
        title: `${lowStock} item${lowStock === 1 ? '' : 's'} need restocking`,
        body: `Review the low-stock list before your next supplier order.`,
        data: { count: lowStock, href: '/pharmacy/inventory?filter=low_stock' },
        choices: {
          email: preference.low_stock_email_opt_in,
          sms: preference.low_stock_sms_opt_in || preference.stock_digest_sms_opt_in,
        },
        email: preference.owner_email,
        phone: preference.owner_phone || pharmacy.phone,
        smsBody: `StocMed: ${lowStock} low-stock item(s) need review at ${pharmacy.pharmacy_name}.`,
        dailyEmailCap: preference.daily_email_cap,
        dailySmsCap: preference.daily_sms_cap,
      }))
    }
    if ((expiring ?? 0) > 0) {
      jobs.push(queueNotification({
        eventKey: `expiry:${preference.pharmacy_id}:${today}`,
        recipientType: 'pharmacist',
        recipientId: pharmacy.user_id,
        pharmacyId: preference.pharmacy_id,
        type: 'expiry',
        title: `${expiring} batch${expiring === 1 ? '' : 'es'} expire within 30 days`,
        body: 'Review these batches and plan safe sell-through or removal.',
        data: { count: expiring, href: '/pharmacy/inventory?filter=expiring' },
        choices: {
          email: preference.expiry_email_opt_in,
          sms: preference.expiry_sms_opt_in || preference.stock_digest_sms_opt_in,
        },
        email: preference.owner_email,
        phone: preference.owner_phone || pharmacy.phone,
        smsBody: `StocMed: ${expiring} batch(es) expire within 30 days at ${pharmacy.pharmacy_name}.`,
        dailyEmailCap: preference.daily_email_cap,
        dailySmsCap: preference.daily_sms_cap,
      }))
    }
    const results = await Promise.allSettled(jobs)
    generated += results.filter(result => result.status === 'fulfilled').length
  }
  return NextResponse.json({ considered: preferences?.length ?? 0, generated })
}
