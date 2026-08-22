import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { deliverQueuedEmail } from '@/lib/notifications/email'
import { deliverQueuedSms } from '@/lib/notifications/sms'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const { data, error } = await (admin.from('notification_deliveries') as any)
    .select('*')
    .in('status', ['queued', 'retry'])
    .lte('send_after', new Date().toISOString())
    .order('created_at')
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = await Promise.allSettled((data || []).map((delivery: any) =>
    delivery.channel === 'email'
      ? deliverQueuedEmail(delivery)
      : deliverQueuedSms(delivery),
  ))
  return NextResponse.json({
    processed: results.length,
    rejected: results.filter(result => result.status === 'rejected').length,
  })
}
