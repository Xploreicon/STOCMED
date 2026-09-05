import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { deliveryHandler } from '@/lib/notifications/dispatcher'

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
    .limit(25)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: PromiseSettledResult<unknown>[] = []
  const deliveries = data || []
  // Resend currently documents a shared five-request-per-second rate limit.
  // Dispatch two at a time with a small gap so broadcasts cannot starve other
  // notification traffic or create a sudden provider burst.
  for (let index = 0; index < deliveries.length; index += 2) {
    const batch = deliveries.slice(index, index + 2)
    results.push(...await Promise.allSettled(batch.map(async (delivery: any) => {
      const handler = deliveryHandler(delivery.channel)
      if (!handler) throw new Error(`Unsupported notification channel: ${delivery.channel}`)
      return handler(delivery)
    })))
    if (index + 2 < deliveries.length) {
      await new Promise(resolve => setTimeout(resolve, 550))
    }
  }
  return NextResponse.json({
    processed: results.length,
    rejected: results.filter(result => result.status === 'rejected').length,
  })
}
