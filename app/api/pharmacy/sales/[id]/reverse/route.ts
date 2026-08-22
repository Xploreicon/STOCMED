import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { checkStaffPermission } from '@/lib/staff-permissions'

const schema = z.object({
  kind: z.enum(['void', 'refund']),
  reason: z.string().trim().min(3).max(300),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const staffAccess = await checkStaffPermission(supabase, pharmacy.id, request, 'can_refund')
  if (!staffAccess.allowed) return NextResponse.json({ error: staffAccess.error, code: staffAccess.code }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { id } = await params

  const { data: sale } = await supabase.from('sales')
    .select('id,status').eq('id', id).eq('pharmacy_id', pharmacy.id).maybeSingle()
  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if ((sale as any).status !== 'completed') {
    return NextResponse.json({ error: 'Only a completed sale can be reversed' }, { status: 409 })
  }

  const { data, error } = await supabase.rpc('reverse_completed_sale', {
    p_pharmacy_id: pharmacy.id,
    p_sale_id: id,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
    p_sp_token: request.headers.get('x-sp-authorization'),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  if ((data as any)?.success === false && (data as any)?.code === 'SP_AUTH_REQUIRED') {
    return NextResponse.json(
      { error: (data as any).error, code: 'SP_AUTH_REQUIRED' },
      { status: 403 },
    )
  }
  return NextResponse.json({ reversal: data })
}
