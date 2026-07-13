import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.rpc('delete_my_data')
  return error
    ? NextResponse.json({ error: 'Could not delete account data' }, { status: 500 })
    : NextResponse.json(data)
}
