import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  const [reservations, provisionalPharmacies] = await Promise.all([
    (admin.rpc as any)('expire_reservations'),
    (admin.rpc as any)('expire_provisional_pharmacies'),
  ])

  if (reservations.error || provisionalPharmacies.error) {
    return NextResponse.json({
      error: reservations.error?.message ?? provisionalPharmacies.error?.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    reservations_expired: reservations.data ?? 0,
    provisional_pharmacies_expired: provisionalPharmacies.data ?? 0,
  })
}
