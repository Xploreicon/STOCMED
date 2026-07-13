import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { reportQuerySchema } from '@/lib/validation/reporting'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })

  const to = parsed.data.to ?? new Date().toISOString().slice(0, 10)
  const from = parsed.data.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase.rpc('get_pharmacy_reports', {
    p_pharmacy_id: pharmacy.id,
    p_from: from,
    p_to: to,
  })

  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ reports: data })
}
