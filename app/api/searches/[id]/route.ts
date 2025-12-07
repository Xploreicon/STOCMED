import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify search belongs to this user
    const { data: existingSearch, error: checkError } = await supabase
      .from('searches')
      .select('user_id')
      .eq('id', id)
      .single()

    if (checkError || !existingSearch) {
      return NextResponse.json(
        { error: 'Search not found' },
        { status: 404 }
      )
    }

    if ((existingSearch as any).user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden: Search does not belong to you' },
        { status: 403 }
      )
    }

    // Delete search
    const { error: deleteError } = await supabase
      .from('searches')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting search:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete search' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Search deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
