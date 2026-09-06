import 'server-only'
import { parseControlledTestRecipientEmails } from '@/lib/admin/controlled-test-audience'
import { getAdminClient } from '@/lib/supabase/admin'
import type { BroadcastAudience } from '@/lib/admin/broadcast-schema'

export type BroadcastRecipient = {
  user_id: string
  pharmacy_id: string | null
  email: string
  display_name: string
}

export async function resolveBroadcastAudience(actorId: string, audience: BroadcastAudience) {
  return resolveAudienceRpc('resolve_broadcast_audience', actorId, audience)
}

export async function resolvePushAudience(actorId: string, audience: BroadcastAudience) {
  return resolveAudienceRpc('resolve_push_audience', actorId, audience)
}

async function resolveAudienceRpc(
  rpcName: 'resolve_broadcast_audience' | 'resolve_push_audience',
  actorId: string,
  audience: BroadcastAudience,
) {
  const admin = getAdminClient()
  if (!admin) throw new Error('Broadcast database is not configured')
  if (audience.kind === 'test_list') {
    return resolveControlledTestAudience(admin, rpcName, actorId)
  }
  const pageSize = 1000
  const recipients: BroadcastRecipient[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await (admin as any)
      .rpc(rpcName, {
        p_actor_id: actorId,
        p_audience: audience,
      })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const page = (data || []) as BroadcastRecipient[]
    recipients.push(...page)
    if (page.length < pageSize) break
  }

  return Array.from(new Map(
    recipients.map(recipient => [recipient.user_id, recipient]),
  ).values())
}

async function resolveControlledTestAudience(
  admin: NonNullable<ReturnType<typeof getAdminClient>>,
  rpcName: 'resolve_broadcast_audience' | 'resolve_push_audience',
  actorId: string,
) {
  const emails = parseControlledTestRecipientEmails(process.env.NOTIFICATION_TEST_RECIPIENTS)
  const recipients: BroadcastRecipient[] = []

  for (const email of emails) {
    const { data: directory, error: directoryError } = await (admin as any).rpc(
      'search_broadcast_directory',
      { p_actor_id: actorId, p_kind: 'user', p_query: email },
    )
    if (directoryError) throw directoryError
    const account = ((directory || []) as BroadcastRecipient[])
      .find(candidate => candidate.email.toLowerCase() === email)
    if (!account) throw new Error(`Controlled test account is missing: ${email}`)

    const { data: eligible, error: audienceError } = await (admin as any).rpc(rpcName, {
      p_actor_id: actorId,
      p_audience: { kind: 'individual_user', user_id: account.user_id },
    })
    if (audienceError) throw audienceError
    const recipient = ((eligible || []) as BroadcastRecipient[])
      .find(candidate => candidate.user_id === account.user_id)
    if (!recipient) {
      throw new Error(`Controlled test account is not eligible or is opted out: ${email}`)
    }
    recipients.push(recipient)
  }

  const unique = Array.from(new Map(
    recipients.map(recipient => [recipient.user_id, recipient]),
  ).values())
  if (unique.length !== 2) {
    throw new Error('Controlled test audience did not resolve to exactly two accounts')
  }
  return unique
}
