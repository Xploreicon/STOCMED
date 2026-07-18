import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const documentSchema = z.object({
  document_kind: z.enum(['premises_certificate', 'superintendent_annual_licence']),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const parsed = documentSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid document request' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestId = randomUUID()
  const { data, error } = await (supabase.rpc as any)(
    'authorize_and_log_pharmacy_verification_document_access',
    {
      p_submission_id: params.id,
      p_document_kind: parsed.data.document_kind,
      p_request_id: requestId,
    }
  )
  const access = Array.isArray(data) ? data[0] : data
  if (error || !access?.file_path) {
    return NextResponse.json({ error: error?.message ?? 'Document access denied' }, { status: 403 })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Verification service unavailable' }, { status: 503 })
  const { data: signed, error: signError } = await admin.storage
    .from('pharmacy-verification-documents')
    .createSignedUrl(access.file_path, 300)
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not open the verification document' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: 300, request_id: requestId }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
