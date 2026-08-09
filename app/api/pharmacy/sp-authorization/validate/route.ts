import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { hasSpAuthorization, SP_ACTIONS, SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'

const schema = z.object({
  action: z.enum(SP_ACTIONS),
  token: z.string().min(32),
})

export async function POST(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })

  const valid = await hasSpAuthorization(
    supabase,
    pharmacy.id,
    parsed.data.token,
    parsed.data.action,
  )
  if (!valid) return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
  return NextResponse.json({ valid: true })
}
