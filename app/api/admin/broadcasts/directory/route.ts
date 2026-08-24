import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const kind = request.nextUrl.searchParams.get('kind')
  const query = request.nextUrl.searchParams.get('q')?.trim() || ''
  if (!['pharmacy', 'user'].includes(kind || '') || query.length < 2) {
    return NextResponse.json({ results: [] })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Broadcast service unavailable' }, { status: 503 })
  const { data, error } = await (admin as any).rpc('search_broadcast_directory', {
    p_actor_id: viewer.user.id,
    p_kind: kind,
    p_query: query,
  })
  if (error) return NextResponse.json({ error: 'Could not search recipients' }, { status: 500 })
  return NextResponse.json({ results: data || [] }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
