import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestId = randomUUID()
  const { data, error } = await (supabase.rpc as any)('authorize_and_log_rx_document_access', {
    p_submission_id: params.id,
    p_context: 'destination_review',
    p_request_id: requestId,
  })
  const access = Array.isArray(data) ? data[0] : data
  if (error || !access?.file_path) {
    return NextResponse.json({ error: error?.message ?? 'Prescription access denied' }, { status: 403 })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Prescription service unavailable' }, { status: 503 })
  const { data: signed, error: signError } = await admin.storage
    .from('prescriptions')
    .createSignedUrl(access.file_path, 300)
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not open prescription document' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: 300, request_id: requestId }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
