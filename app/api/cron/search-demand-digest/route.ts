import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { renderSearchDemandDigest, type SearchDemandItem } from '@/lib/email/search-demand'
import { createOutboxDelivery, finishDelivery, underGlobalChannelCap } from '@/lib/notifications/core'
import { createScopedUnsubscribeToken } from '@/lib/notifications/unsubscribe'

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

  const until = new Date()
  const since = new Date(until.getTime() - 24 * 60 * 60 * 1000)
  const { data, error } = await (admin as any).rpc('get_search_digest_candidates', {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
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
        idempotencyKey: `search-demand:${until.toISOString().slice(0, 10)}:${candidate.pharmacy_id}`,
        pharmacyId: candidate.pharmacy_id,
        userId: candidate.user_id,
        payload: { ...rendered, unsubscribeUrl, itemCount: candidate.items.length },
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

  return NextResponse.json({ candidates: (data || []).length, queued, duplicate, skipped, failed })
}
