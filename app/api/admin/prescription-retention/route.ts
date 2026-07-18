import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const policySchema = z.object({
  retention_days: z.number().int().min(1).max(3650),
  legal_basis: z.string().trim().min(3).max(1000),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer, error: viewerError } = await (supabase as any)
    .from('users')
    .select('is_admin,is_stocmed_sp,is_licensed_pharmacist')
    .eq('user_id', user.id)
    .maybeSingle()
  if (viewerError || (!viewer?.is_admin && !(viewer?.is_stocmed_sp && viewer?.is_licensed_pharmacist))) {
    return NextResponse.json({ error: 'Oversight access denied' }, { status: 403 })
  }

  const { data, error } = await (supabase as any)
    .from('rx_retention_policy')
    .select('retention_days,is_confirmed,confirmed_at,legal_basis,updated_at')
    .eq('singleton', true)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ policy: data, can_manage: viewer.is_admin === true }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

export async function PATCH(request: NextRequest) {
  const parsed = policySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Enter an approved retention duration and legal basis' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await (supabase.rpc as any)('set_rx_retention_policy', {
    p_retention_days: parsed.data.retention_days,
    p_legal_basis: parsed.data.legal_basis,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ policy: data }, { headers: { 'Cache-Control': 'no-store, private' } })
}
