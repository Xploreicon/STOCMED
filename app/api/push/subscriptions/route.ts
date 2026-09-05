import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(value => value.startsWith('https://')),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
})

const deleteSchema = z.object({ endpoint: z.string().url().max(2048) })

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await (supabase as any).from('push_subscriptions')
    .select('id,endpoint,created_at,updated_at')
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not load push subscriptions' }, { status: 500 })
  return NextResponse.json({ subscriptions: data || [] }, { headers: { 'Cache-Control': 'no-store, private' } })
}

export async function POST(request: NextRequest) {
  const body = subscriptionSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await (supabase as any).rpc('set_authenticated_push_subscription', {
    p_endpoint: body.data.endpoint,
    p_p256dh: body.data.keys.p256dh,
    p_auth_key: body.data.keys.auth,
    p_user_agent: request.headers.get('user-agent'),
  })
  if (error) return NextResponse.json({ error: 'Could not enable push notifications' }, { status: 500 })
  return NextResponse.json({ subscription: data }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const body = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await (supabase as any).rpc('delete_authenticated_push_subscription', {
    p_endpoint: body.data.endpoint,
  })
  if (error) return NextResponse.json({ error: 'Could not disable push notifications' }, { status: 500 })
  return NextResponse.json({ deleted: Boolean(data) })
}
