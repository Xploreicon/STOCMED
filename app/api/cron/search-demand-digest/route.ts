import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { renderSearchDemandDigest, type SearchDemandItem } from '@/lib/email/search-demand'
import { createOutboxDelivery, finishDelivery, underGlobalChannelCap } from '@/lib/notifications/core'
import { createScopedUnsubscribeToken } from '@/lib/notifications/unsubscribe'
import { getSearchDigestWindow } from '@/lib/notifications/digest-frequency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type DigestCandidate = {
  pharmacy_id: string
  user_id: string
  email: string
  pharmacy_name: string
  items: SearchDemandItem[]
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const window = getSearchDigestWindow(new Date(), {
    frequency: process.env.SEARCH_DEMAND_DIGEST_FREQUENCY,
    dailyUtcHour: Number(process.env.SEARCH_DEMAND_DIGEST_UTC_HOUR || 6),
  })
  if (!window.due) {
    return NextResponse.json({ skipped: true, reason: 'not_scheduled_hour', frequency: window.frequency })
  }
  const { data, error } = await (admin as any).rpc('get_search_digest_candidates', {
    p_since: window.since.toISOString(),
    p_until: window.until.toISOString(),
  })
  if (error) {
    console.error('Could not aggregate search demand:', error)
    return NextResponse.json({ error: 'Could not aggregate search demand' }, { status: 500 })
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com').replace(/\/$/, '')
  let queued = 0
  let duplicate = 0
  let skipped = 0
  let failed = 0
  for (const candidate of (data || []) as DigestCandidate[]) {
    try {
      const token = createScopedUnsubscribeToken(candidate.user_id, 'search_digest')
      const unsubscribeUrl = `${siteUrl}/u/${encodeURIComponent(token)}`
      const rendered = renderSearchDemandDigest({
        pharmacyName: candidate.pharmacy_name,
        items: candidate.items,
        unsubscribeUrl,
        dashboardUrl: `${siteUrl}/pharmacy/dashboard`,
      })
      const result = await createOutboxDelivery({
        channel: 'email',
        provider: 'resend',
        type: 'search_demand_digest',
        recipient: candidate.email,
        idempotencyKey: window.frequency === 'daily'
          ? `search-demand:${window.periodKey}:${candidate.pharmacy_id}`
          : `search-demand:hourly:${window.periodKey}:${candidate.pharmacy_id}`,
        pharmacyId: candidate.pharmacy_id,
        userId: candidate.user_id,
        payload: {
          ...rendered,
          unsubscribeUrl,
          oneClickUnsubscribe: true,
          itemCount: candidate.items.length,
        },
      })
      if (result.duplicate) {
        duplicate += 1
      } else if (!await underGlobalChannelCap('email')) {
        await finishDelivery(result.delivery.id, {
          status: 'skipped',
          error: 'Daily email safety cap reached',
        })
        skipped += 1
      } else {
        queued += 1
      }
    } catch (digestError) {
      console.error('Could not queue pharmacy search-demand digest:', digestError)
      failed += 1
    }
  }

  return NextResponse.json({
    frequency: window.frequency,
    period: window.periodKey,
    candidates: (data || []).length,
    queued,
    duplicate,
    skipped,
    failed,
  })
}
