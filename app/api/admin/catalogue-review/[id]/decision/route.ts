import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

const reviewEditSchema = z.object({
  generic_name: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  strength: z.string().nullable().optional(),
  dosage_form: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  pack_size: z.string().nullable().optional(),
  nafdac_number: z.string().nullable().optional(),
  atc_code: z.string().nullable().optional(),
  requires_prescription: z.boolean().nullable().optional(),
}).strict()

const decisionSchema = z.object({
  decision_status: z.enum(['pending', 'approved', 'rejected', 'held']),
  edit: reviewEditSchema.optional(),
  resolved_conflict_reasons: z.array(z.string().min(1)).nullable().optional(),
  resolution_evidence: z.object({ summary: z.string().max(4000).optional() }).passthrough().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  resolution_action: z.enum(['new_identity', 'existing_enrichment']).nullable().optional(),
  target_product_id: z.string().uuid().nullable().optional(),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const queueId = z.string().uuid().safeParse(params.id)
  const body = decisionSchema.safeParse(await request.json().catch(() => null))
  if (!queueId.success || !body.success) {
    return NextResponse.json({ error: 'Invalid catalogue review request' }, { status: 400 })
  }
  if (
    (body.data.decision_status === 'rejected' || body.data.decision_status === 'held')
    && !body.data.notes?.trim()
  ) {
    return NextResponse.json({ error: 'A reason is required for reject or hold decisions' }, { status: 400 })
  }

  const { data, error } = await (access.supabase.rpc as any)(
    'review_catalogue_reconciliation_candidate',
    {
      p_queue_id: queueId.data,
      p_decision_status: body.data.decision_status,
      p_edit: body.data.edit ?? {},
      p_resolved_conflict_reasons: body.data.resolved_conflict_reasons ?? null,
      p_resolution_evidence: body.data.resolution_evidence ?? null,
      p_notes: body.data.notes?.trim() || null,
      p_resolution_action: body.data.resolution_action ?? null,
      p_target_product_id: body.data.target_product_id ?? null,
    },
  )

  if (error) {
    const status = error.message?.includes('blocked') ? 409 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } })
}
