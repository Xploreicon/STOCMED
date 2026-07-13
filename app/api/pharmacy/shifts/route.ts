import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'

const querySchema = z.object({
  shift_id: z.string().uuid().optional(),
})

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid shift query' }, { status: 400 })

  if (parsed.data.shift_id) {
    const { data, error } = await supabase.rpc('get_shift_report', { p_shift_id: parsed.data.shift_id })
    return error
      ? NextResponse.json({ error: error.message }, { status: 400 })
      : NextResponse.json({ report: data })
  }

  const { data: shifts, error } = await supabase.from('shifts').select('*')
    .eq('pharmacy_id', pharmacy.id).order('opened_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const reports = await Promise.all((shifts ?? []).map(async (shift: { id: string }) => {
    const result = await supabase.rpc('get_shift_report', { p_shift_id: shift.id })
    return result.error ? null : result.data
  }))

  return NextResponse.json({
    context: { pharmacy_id: pharmacy.id, cashier_id: user.id, cashier_name: user.user_metadata?.full_name || user.email },
    shifts: shifts ?? [],
    reports: reports.filter(Boolean),
  })
}
