import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
  const [{ data: reservations, error }, { data: prescriptions, error: prescriptionError }] = await Promise.all([
    (supabase.rpc as any)('get_pharmacy_reservations', { p_pharmacy_id: pharmacy.id }),
    (supabase.rpc as any)('get_destination_prescription_queue', { p_pharmacy_id: pharmacy.id }),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (prescriptionError && prescriptionError.code !== 'PGRST202' && prescriptionError.code !== '42883') {
    return NextResponse.json({ error: prescriptionError.message }, { status: 500 })
  }

  const { error: seenError } = await (supabase.rpc as any)('mark_pharmacy_reservation_queue_seen', {
    p_pharmacy_id: pharmacy.id,
  })
  if (seenError && seenError.code !== 'PGRST202' && seenError.code !== '42883') {
    console.error('Could not mark reservation queue viewed:', seenError)
  }

  return NextResponse.json({
    reservations: reservations ?? [],
    prescriptions: prescriptions ?? [],
  }, { headers: { 'Cache-Control': 'no-store' } })
}
