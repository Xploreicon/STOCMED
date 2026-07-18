import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const reviewSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  notes: z.string().trim().max(1000).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const parsed = reviewSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid clinical pre-review decision' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await (supabase as any)
    .from('users')
    .select(`
      is_stocmed_sp,stocmed_sp_authorized_at,stocmed_sp_authorization_basis,
      is_licensed_pharmacist,pharmacist_license_verified_at,pharmacist_license_verification_basis
    `)
    .eq('user_id', user.id)
    .maybeSingle()
  const canPerformClinicalReview = Boolean(
    viewer?.is_stocmed_sp
    && viewer?.stocmed_sp_authorized_at
    && viewer?.stocmed_sp_authorization_basis?.trim()
    && viewer?.is_licensed_pharmacist
    && viewer?.pharmacist_license_verified_at
    && viewer?.pharmacist_license_verification_basis?.trim()
  )
  if (!canPerformClinicalReview) {
    return NextResponse.json({ error: 'Only the provenance-verified StocMed SP may perform pilot clinical pre-review' }, { status: 403 })
  }

  const { data, error } = await (supabase.rpc as any)('review_destination_prescription', {
    p_submission_id: params.id,
    p_decision: parsed.data.decision,
    p_notes: parsed.data.notes ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } })
}
