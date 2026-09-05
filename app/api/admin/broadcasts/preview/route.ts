import { NextRequest, NextResponse } from 'next/server'
import { broadcastComposeSchema } from '@/lib/admin/broadcast-schema'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { renderBroadcastEmail } from '@/lib/email/broadcast'

export async function POST(request: NextRequest) {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  const parsed = broadcastComposeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the broadcast' }, { status: 400 })
  }
  const rendered = renderBroadcastEmail({
    subject: parsed.data.subject,
    bodyMarkdown: parsed.data.body_markdown,
    bodyFormat: parsed.data.body_format,
    template: parsed.data.template,
    unsubscribeUrl: 'https://askstocmed.com/u/preview',
  })
  return NextResponse.json(rendered, { headers: { 'Cache-Control': 'no-store, private' } })
}
