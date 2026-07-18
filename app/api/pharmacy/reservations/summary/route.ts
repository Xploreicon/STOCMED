import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })

  const { data, error } = await (supabase.rpc as any)('get_pharmacy_reservation_summary', {
    p_pharmacy_id: pharmacy.id,
  })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return NextResponse.json({ active_count: 0, unseen_count: 0, pending_prescriptions: 0 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    active_count: Number(summary?.active_count ?? 0),
    unseen_count: Number(summary?.unseen_count ?? 0),
    pending_prescriptions: Number(summary?.pending_prescriptions ?? 0),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
