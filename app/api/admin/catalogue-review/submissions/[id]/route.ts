import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

const editSchema = z.object({
  generic_name: z.string().min(1).optional(),
  brand_name: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  strength: z.string().min(1).optional(),
  dosage_form: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  pack_size: z.string().nullable().optional(),
  nafdac_number: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  requires_prescription: z.boolean().optional(),
}).strict()

const decisionSchema = z.object({
  action: z.enum(['edit', 'verify', 'reject']),
  edit: editSchema.optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const productId = z.string().uuid().safeParse(params.id)
  const body = decisionSchema.safeParse(await request.json().catch(() => null))
  if (!productId.success || !body.success) {
    return NextResponse.json({ error: 'Invalid catalogue submission review request' }, { status: 400 })
  }
  if (body.data.action === 'reject' && !body.data.notes?.trim()) {
    return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 })
  }

  const { data, error } = await (access.supabase.rpc as any)(
    'review_unverified_catalogue_product',
    {
      p_product_id: productId.data,
      p_action: body.data.action,
      p_edit: body.data.edit || {},
      p_notes: body.data.notes?.trim() || null,
    },
  )
  if (error) {
    const conflict = /required|already|inventory|unverified|duplicate/i.test(error.message || '')
    return NextResponse.json({ error: error.message }, { status: conflict ? 409 : 400 })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } })
}
