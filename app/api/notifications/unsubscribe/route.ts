import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubscribeToken } from '@/lib/notifications/unsubscribe'

async function unsubscribe(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const userId = token ? verifyUnsubscribeToken(token) : null
  if (!userId) return false
  const admin = getAdminClient()
  if (!admin) return false
  const { data, error } = await (admin as any).rpc('unsubscribe_notification_user', {
    p_user_id: userId,
  })
  return !error && data === true
}

export async function GET(request: NextRequest) {
  const ok = await unsubscribe(request)
  return new NextResponse(
    `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px;color:#17332d"><h1>${ok ? 'You are unsubscribed' : 'This unsubscribe link is invalid or expired'}</h1><p>${ok ? 'StocMed product email has been turned off. Account and security email is unaffected.' : 'Open your StocMed settings to change email preferences.'}</p></body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function POST(request: NextRequest) {
  return NextResponse.json({ unsubscribed: await unsubscribe(request) })
}
