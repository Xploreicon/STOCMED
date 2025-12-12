import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Save a chat message
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    const body = await request.json()
    const { message, role, metadata, sessionId } = body

    if (!message || !role) {
      return NextResponse.json(
        { error: 'Message and role are required' },
        { status: 400 }
      )
    }

    if (role !== 'user' && role !== 'assistant') {
      return NextResponse.json(
        { error: 'Role must be either "user" or "assistant"' },
        { status: 400 }
      )
    }

    // For logged-in users, require user authentication
    // For anonymous users, require sessionId
    if (!user && !sessionId) {
      return NextResponse.json(
        { error: 'User authentication or session ID required' },
        { status: 401 }
      )
    }

    // Save message to database
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: user?.id || null,
        session_id: sessionId || null,
        content: message,
        role,
        metadata: metadata || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving chat message:', error)
      return NextResponse.json(
        { error: 'Failed to save message' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Get chat history for current user or session
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const sessionId = searchParams.get('sessionId')

    // Require either user authentication or session ID
    if (!user && !sessionId) {
      return NextResponse.json(
        { error: 'User authentication or session ID required' },
        { status: 401 }
      )
    }

    // Build query based on user or session
    let query = supabase
      .from('chat_messages')
      .select('*')
      .order('timestamp', { ascending: true })
      .range(offset, offset + limit - 1)

    if (user) {
      query = query.eq('user_id', user.id)
    } else if (sessionId) {
      query = query.eq('session_id', sessionId)
    }

    const { data: messages, error } = await query

    if (error) {
      console.error('Error fetching chat messages:', error)
      return NextResponse.json(
        { error: 'Failed to fetch messages' },
        { status: 500 }
      )
    }

    // Transform response to match expected format
    const transformedMessages = (messages || []).map((msg: any) => ({
      id: msg.id,
      role: msg.role,
      message: msg.content, // Map content back to message for compatibility
      metadata: msg.metadata,
      created_at: msg.timestamp || msg.created_at,
    }))

    return NextResponse.json({ messages: transformedMessages })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
