import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { verifyScopedUnsubscribeToken } from '@/lib/notifications/unsubscribe'

export const dynamic = 'force-dynamic'

function neutralResponse() {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences updated</title></head><body style="margin:0;background:#f5faf8;color:#17332d;font-family:Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:28px"><div style="font-size:24px;font-weight:800;color:#087f5b">StocMed</div><section style="margin-top:22px;background:#fff;border:1px solid #dce9e4;border-radius:14px;padding:28px"><h1 style="font-size:24px;margin:0 0 12px">Email preferences updated</h1><p style="line-height:1.6;margin:0">If this link matched an active preference, that email category has been turned off. You can close this page.</p></section></main></body></html>`, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

async function unsubscribe(token: string) {
  const decoded = verifyScopedUnsubscribeToken(token)
  const admin = getAdminClient()
  if (decoded && admin) {
    await (admin as any).rpc('suppress_email_category', {
      p_user_id: decoded.userId,
      p_category: decoded.category,
    })
  }
  return neutralResponse()
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  return unsubscribe(params.token)
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  return unsubscribe(params.token)
}
