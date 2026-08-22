import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendReservationNotifications } from '@/lib/notifications/reservations'

const createReservationSchema = z.object({
  inventory_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
  session_id: z.string().min(8).max(200).optional(),
  patient_phone: z.string().min(7).max(32).optional(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view your holds' }, { status: 401 })

  const { data, error } = await (supabase as any)
    .from('reservations')
    .select('id, quantity, status, reserved_at, expires_at, pickup_code, cancellation_reason, pharmacy_id, inventory_id, pharmacies(pharmacy_name,address,phone), pharmacy_inventory(products(generic_name,brand_name,strength))')
    .eq('patient_id', user.id)
    .order('reserved_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reservations: data ?? [] })
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'create-reservation', 10, 60_000)
  if (!rateLimit.success && rateLimit.response) return rateLimit.response

  const payload = createReservationSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Invalid reservation request', details: payload.error.flatten() }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to reserve medication' }, { status: 401 })
  const { data, error } = await (supabase.rpc as any)('create_reservation', {
    p_inventory_id: payload.data.inventory_id,
    p_quantity: payload.data.quantity,
    p_session_id: payload.data.session_id ?? null,
    p_patient_phone: payload.data.patient_phone ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })

  // The hold is authoritative. Notification setup or provider failure must not
  // roll it back; the durable outbox will retry any queued delivery.
  try {
    const reservation = Array.isArray(data) ? data[0] : data
    if (reservation?.id) await sendReservationNotifications(reservation.id)
  } catch (notificationError) {
    console.error('Non-fatal reservation notification failure:', notificationError)
  }
  return NextResponse.json({ reservation: data }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const body = z.object({ id: z.string().uuid(), reason: z.string().max(300).optional() }).safeParse(await request.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid cancellation request' }, { status: 400 })
  const supabase = await createClient()
  const { data, error } = await (supabase.rpc as any)('cancel_reservation', {
    p_reservation_id: body.data.id,
    p_reason: body.data.reason ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ reservation: data })
}
