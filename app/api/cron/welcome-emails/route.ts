import { NextRequest, NextResponse } from 'next/server'
import { renderWelcomeEmail, type WelcomeRole } from '@/lib/email/welcome'
import { createOutboxDelivery, finishDelivery, underGlobalChannelCap } from '@/lib/notifications/core'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type WelcomeJob = {
  user_id: string
  role: WelcomeRole
  attempts: number
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const { data, error } = await (admin as any).from('welcome_email_jobs')
    .select('user_id,role,attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(50)
  if (error) return NextResponse.json({ error: 'Could not load welcome email jobs' }, { status: 500 })

  const jobs = (data || []) as WelcomeJob[]
  const userIds = jobs.map(job => job.user_id)
  const [{ data: profiles }, { data: pharmacies }] = userIds.length
    ? await Promise.all([
      (admin as any).from('users').select('user_id,email,full_name,role').in('user_id', userIds),
      (admin as any).from('pharmacies').select('id,user_id,pharmacy_name,is_active').in('user_id', userIds),
    ])
    : [{ data: [] }, { data: [] }]
  const profileById = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]))
  const pharmacyByUser = new Map((pharmacies || []).map((pharmacy: any) => [pharmacy.user_id, pharmacy]))
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://askstocmed.com').replace(/\/$/, '')

  let queued = 0
  let duplicate = 0
  let skipped = 0
  let failed = 0
  for (const job of jobs) {
    try {
      const profile: any = profileById.get(job.user_id)
      const pharmacy: any = pharmacyByUser.get(job.user_id)
      if (!profile?.email || !['patient', 'pharmacy'].includes(profile.role)) {
        throw new Error('Account profile is incomplete')
      }
      const rendered = renderWelcomeEmail({
        role: job.role,
        name: profile.full_name || (job.role === 'pharmacy' ? pharmacy?.pharmacy_name : 'there'),
        pharmacyName: pharmacy?.pharmacy_name,
        siteUrl,
      })
      const result = await createOutboxDelivery({
        channel: 'email',
        provider: 'resend',
        type: `welcome_${job.role}`,
        recipient: String(profile.email).trim().toLowerCase(),
        idempotencyKey: `welcome:${job.user_id}`,
        userId: job.user_id,
        pharmacyId: pharmacy?.id,
        payload: { ...rendered, consent: 'account_service' },
      })
      if (result.duplicate) duplicate += 1
      else if (!await underGlobalChannelCap('email')) {
        await finishDelivery(result.delivery.id, { status: 'skipped', error: 'Daily email safety cap reached' })
        skipped += 1
      } else queued += 1

      await (admin as any).from('welcome_email_jobs').update({
        status: 'queued',
        queued_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', job.user_id).eq('status', 'pending')
    } catch (jobError) {
      failed += 1
      const attempts = Number(job.attempts || 0) + 1
      await (admin as any).from('welcome_email_jobs').update({
        attempts,
        last_error: jobError instanceof Error ? jobError.message.slice(0, 500) : 'Welcome email queue failed',
        next_attempt_at: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 6 * 60 * 60_000)).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', job.user_id).eq('status', 'pending')
      console.error('Could not queue welcome email:', jobError)
    }
  }

  return NextResponse.json({ jobs: jobs.length, queued, duplicate, skipped, failed })
}
