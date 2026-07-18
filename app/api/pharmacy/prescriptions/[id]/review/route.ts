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
  const body = reviewSchema.safeParse(await request.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid review decision' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await (supabase.rpc as any)('review_destination_prescription', {
    p_submission_id: params.id,
    p_decision: body.data.decision,
    p_notes: body.data.notes ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
