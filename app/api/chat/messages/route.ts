import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { message, role, metadata } = await request.json()

    if (!message || !role) {
      return NextResponse.json(
        { error: 'Message content and role are required.' },
        { status: 400 }
      )
    }

    const { error: insertError } = await (supabase
      .from('chat_messages') as any).insert({
      user_id: user.id,
      content: message,
      role,
      session_id: metadata?.session_id || null,
    })

    if (insertError) {
      console.error('Error inserting chat message:', insertError)
      return NextResponse.json(
        { error: 'Failed to store chat message.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('Unexpected chat message error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
