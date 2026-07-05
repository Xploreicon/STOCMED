import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')
  const origin = requestUrl.origin

  if (code) {
    const supabase = await createClient()
    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && session) {
      let role = session.user?.user_metadata?.role
      
      // If role is missing in metadata, check the database users table
      if (!role) {
        const { data: dbUser } = await (supabase
          .from('users')
          .select('role')
          .eq('user_id', session.user.id) as any)
          .single()
        role = (dbUser as any)?.role
      }
      
      const userRole = role || 'patient'
      
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/update-password`)
      }
      return NextResponse.redirect(`${origin}${userRole === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard'}`)
    }
  }

  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/update-password`)
  }

  // Fallback URL if no session is established
  return NextResponse.redirect(`${origin}/login`)
}
