import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatMessageSchema } from '@/lib/validation/chat'

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = chatMessageSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid message', details: parsed.error.flatten() }, { status: 400 })

    const { message, role, metadata } = parsed.data
    const hash = crypto.createHash('sha256').update(message.trim().toLowerCase()).digest('hex')
    const now = new Date()
    const { error } = await supabase.from('chat_messages').insert([
      {
        user_id: null, session_id: null, role, content: message, content_hash: hash,
        expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      },
      {
        user_id: user.id, session_id: metadata?.session_id ?? null, role,
        content: `hash:${hash}`, content_hash: hash,
        expires_at: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
      },
    ])
    if (error) return NextResponse.json({ error: 'Failed to store chat message' }, { status: 500 })
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
