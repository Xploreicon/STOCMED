import { NextRequest, NextResponse } from 'next/server'
import { broadcastAudienceSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { resolvePushAudience } from '@/lib/admin/broadcast-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const parsed = broadcastAudienceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the audience' }, { status: 400 })
  try {
    const recipients = await resolvePushAudience(viewer.user.id, parsed.data)
    return NextResponse.json({ count: recipients.length }, { headers: { 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    console.error('Could not resolve push audience:', error)
    return NextResponse.json({ error: 'Could not calculate subscribed push recipients' }, { status: 500 })
  }
}
