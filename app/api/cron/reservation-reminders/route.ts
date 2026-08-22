import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { queueNotification } from '@/lib/notifications/events'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const now = new Date()
  const soon = new Date(now.getTime() + 45 * 60_000)
  const { data: reservations, error } = await (admin.from('reservations') as any)
    .select('id,pickup_code,expires_at,patient_phone,patient_id,pharmacy_id,pharmacies(pharmacy_name),pharmacy_inventory(products(generic_name,brand_name))')
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .lte('expires_at', soon.toISOString())
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let queued = 0
  for (const reservation of reservations || []) {
    const [{ data: patient }, { data: preference }, { data: feature }] = await Promise.all([
      (admin.from('users') as any).select('phone').eq('user_id', reservation.patient_id).maybeSingle(),
      (admin.from('notification_preferences') as any).select('reminder_sms_opt_in,patient_sms_consent').eq('user_id', reservation.patient_id).maybeSingle(),
      (admin.from('pharmacy_features') as any).select('is_enabled').eq('pharmacy_id', reservation.pharmacy_id).eq('feature_key', 'notifications').maybeSingle(),
    ])
    if (feature?.is_enabled !== true) continue
    const phone = reservation.patient_phone || patient?.phone
    const pharmacy = Array.isArray(reservation.pharmacies) ? reservation.pharmacies[0] : reservation.pharmacies
    const inventory = Array.isArray(reservation.pharmacy_inventory) ? reservation.pharmacy_inventory[0] : reservation.pharmacy_inventory
    const product = Array.isArray(inventory?.products) ? inventory.products[0] : inventory?.products
    const medication = product?.brand_name || product?.generic_name || 'medication'
    const result = await queueNotification({
      eventKey: `reservation:${reservation.id}:reminder`,
      recipientType: 'patient',
      recipientId: reservation.patient_id,
      pharmacyId: reservation.pharmacy_id,
      type: 'reservation_reminder',
      title: 'Your hold expires soon',
      body: `Your ${medication} hold at ${pharmacy?.pharmacy_name || 'the pharmacy'} expires in about 45 minutes. Code ${reservation.pickup_code}.`,
      data: { reservation_id: reservation.id, href: '/reservations' },
      choices: { sms: Boolean(phone && preference?.reminder_sms_opt_in && preference?.patient_sms_consent) },
      phone,
      smsBody: `StocMed reminder: Your ${medication} hold at ${pharmacy?.pharmacy_name || 'the pharmacy'} expires in about 45 minutes. Code ${reservation.pickup_code}.`,
    }).catch(() => null)
    if (result) queued += 1
  }
  return NextResponse.json({ considered: reservations?.length ?? 0, queued })
}
