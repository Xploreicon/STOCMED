import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'

export async function GET(_request: NextRequest, { params }: { params: { pickupCode: string } }) {
  if (!/^\d{6}$/.test(params.pickupCode)) return NextResponse.json({ error: 'Invalid pickup code' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
  const provisionalDeadline = pharmacy.provisional_expires_at
    ? new Date(pharmacy.provisional_expires_at)
    : null
  const verificationIsCurrent =
    (pharmacy.verification_status === 'full' && pharmacy.is_verified === true)
    || (
      pharmacy.verification_status === 'provisional'
      && provisionalDeadline !== null
      && !Number.isNaN(provisionalDeadline.getTime())
      && provisionalDeadline > new Date()
    )
  if (!verificationIsCurrent) {
    return NextResponse.json(
      { error: 'Current pharmacy verification is required for reservation pickup' },
      { status: 403 }
    )
  }
  const { data, error } = await (supabase as any).from('reservations')
    .select('id, inventory_id, batch_id, quantity, expires_at, status, pharmacy_inventory(price,products(generic_name,brand_name,strength))')
    .eq('pharmacy_id', pharmacy.id).eq('pickup_code', params.pickupCode).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
  if (data.status !== 'active' || new Date(data.expires_at) <= new Date()) return NextResponse.json({ error: 'Reservation is no longer active' }, { status: 409 })
  return NextResponse.json({ reservation: data })
}
