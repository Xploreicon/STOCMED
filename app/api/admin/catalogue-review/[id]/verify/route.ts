import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

const legacyDecisionSchema = z.object({
  action: z.enum(['verify', 'reject']),
}).strict()

// Compatibility endpoint for an already-cached copy of the former review UI.
// The privileged write remains inside the same admin-only SECURITY DEFINER RPC
// used by the replacement submissions editor.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const productId = z.string().uuid().safeParse(params.id)
  const body = legacyDecisionSchema.safeParse(await request.json().catch(() => null))
  if (!productId.success || !body.success) {
    return NextResponse.json({ error: 'Invalid catalogue review request' }, { status: 400 })
  }

  const { data, error } = await (access.supabase.rpc as any)(
    'review_unverified_catalogue_product',
    {
      p_product_id: productId.data,
      p_action: body.data.action,
      p_edit: {},
      p_notes: null,
    },
  )
  if (error) {
    const conflict = /required|already|inventory|unverified/i.test(error.message || '')
    return NextResponse.json({ error: error.message }, { status: conflict ? 409 : 400 })
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } })
}
