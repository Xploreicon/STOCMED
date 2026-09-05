import 'server-only'
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
