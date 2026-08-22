import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'
import { queueNotification } from '@/lib/notifications/events'

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function pickupTime(value: string) {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export async function sendReservationNotifications(reservationId: string) {
  const admin = getAdminClient()
  if (!admin) return
  const { data: reservation, error } = await (admin.from('reservations') as any)
    .select('id,pickup_code,quantity,expires_at,patient_phone,patient_id,pharmacy_id,pharmacies(user_id,pharmacy_name,phone),pharmacy_inventory(products(generic_name,brand_name,strength))')
    .eq('id', reservationId)
    .single()
  if (error || !reservation) return

  const [{ data: feature }, { data: preferences }, { data: patient }, { data: authPatient }] = await Promise.all([
    (admin.from('pharmacy_features') as any)
      .select('is_enabled')
      .eq('pharmacy_id', reservation.pharmacy_id)
      .eq('feature_key', 'notifications')
      .maybeSingle(),
    (admin.from('pharmacy_notification_preferences') as any)
      .select('*')
      .eq('pharmacy_id', reservation.pharmacy_id)
      .maybeSingle(),
    (admin.from('users') as any)
      .select('phone')
      .eq('user_id', reservation.patient_id)
      .maybeSingle(),
    admin.auth.admin.getUserById(reservation.patient_id),
  ])
  if (feature?.is_enabled !== true) return

  const pharmacy = one<any>(reservation.pharmacies)
  const inventory = one<any>(reservation.pharmacy_inventory)
  const product = one<any>(inventory?.products)
  const medication = [product?.brand_name || product?.generic_name || 'medication', product?.strength]
    .filter(Boolean)
    .join(' ')
  const until = pickupTime(reservation.expires_at)
  const patientPhone = reservation.patient_phone || patient?.phone
  const patientBody = `${reservation.quantity} × ${medication} is held at ${pharmacy?.pharmacy_name || 'the pharmacy'} until ${until}. Pickup code: ${reservation.pickup_code}.`
  const jobs: Array<Promise<unknown>> = [
    queueNotification({
      eventKey: `reservation:${reservation.id}:patient-created`,
      recipientType: 'patient',
      recipientId: reservation.patient_id,
      pharmacyId: reservation.pharmacy_id,
      type: 'reservation_created',
      title: 'Your medicine is being held',
      body: patientBody,
      data: { reservation_id: reservation.id, href: '/reservations' },
      choices: { sms: Boolean(patientPhone) },
      phone: patientPhone,
      email: authPatient?.user?.email,
      smsBody: `StocMed: ${patientBody}`,
      dailySmsCap: preferences?.daily_sms_cap ?? 10,
    }),
  ]

  if (pharmacy?.user_id) {
    jobs.push(queueNotification({
      eventKey: `reservation:${reservation.id}:pharmacy-created`,
      recipientType: 'pharmacist',
      recipientId: pharmacy.user_id,
      pharmacyId: reservation.pharmacy_id,
      type: 'reservation_created',
      title: `New hold ${reservation.pickup_code}`,
      body: `${reservation.quantity} × ${medication} must be collected by ${until}.`,
      data: { reservation_id: reservation.id, href: '/pharmacy/reservations' },
      choices: { sms: preferences?.reservation_sms_opt_in === true },
      phone: preferences?.owner_phone || pharmacy.phone,
      smsBody: `StocMed: New hold ${reservation.pickup_code} for ${reservation.quantity}x ${medication}. Collect by ${until}.`,
      dailySmsCap: preferences?.daily_sms_cap ?? 10,
    }))
  }

  await Promise.allSettled(jobs)
}
