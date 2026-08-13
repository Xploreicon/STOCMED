import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import {
  PHARMACY_FEATURE_KEYS,
  PHARMACY_FEATURE_PRESETS,
  isPharmacyFeatureAvailable,
  planPharmacyFeaturePreset,
  type PharmacyFeatureKey,
  type PharmacyFeaturePreset,
} from '@/lib/pharmacy-features'

export const dynamic = 'force-dynamic'

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 } as const
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return { error: 'Pharmacy profile not found', status: 404 } as const
  return { supabase, pharmacy } as const
}

export async function GET() {
  const current = await context()
  if ('error' in current) return NextResponse.json({ error: current.error }, { status: current.status })

  const { data, error } = await current.supabase
    .from('pharmacy_features')
    .select('feature_key,is_enabled,enabled_at,settings')
    .eq('pharmacy_id', current.pharmacy.id)
    .order('feature_key')

  return error
    ? NextResponse.json({ error: 'Could not load features' }, { status: 500 })
    : NextResponse.json({ features: data ?? [] })
}

export async function PUT(request: NextRequest) {
  const current = await context()
  if ('error' in current) return NextResponse.json({ error: current.error }, { status: current.status })

  const body = await request.json().catch(() => null) as {
    feature_key?: PharmacyFeatureKey
    is_enabled?: boolean
    preset?: PharmacyFeaturePreset
    currentCode?: string | null
  } | null

  const validSingle = body?.feature_key
    && PHARMACY_FEATURE_KEYS.includes(body.feature_key)
    && typeof body.is_enabled === 'boolean'
  const validPreset = body?.preset
    && Object.prototype.hasOwnProperty.call(PHARMACY_FEATURE_PRESETS, body.preset)

  if (!validSingle && !validPreset) {
    return NextResponse.json({ error: 'Choose a valid feature or preset' }, { status: 400 })
  }

  if (body?.currentCode != null && !/^\d{6}$/.test(body.currentCode)) {
    return NextResponse.json({ error: 'Enter the current 6-digit superintendent code.' }, { status: 400 })
  }

  if (validSingle && body!.is_enabled === true && !isPharmacyFeatureAvailable(body!.feature_key!)) {
    return NextResponse.json({
      error: 'This feature is not available and cannot be enabled.',
      code: 'FEATURE_UNAVAILABLE',
      feature_key: body!.feature_key,
    }, { status: 409 })
  }

  let skipped: PharmacyFeatureKey[] = []
  let changes: Array<{ feature_key: PharmacyFeatureKey; is_enabled: boolean }>
  if (validPreset) {
    const plan = planPharmacyFeaturePreset(body!.preset!)
    changes = plan.changes
    skipped = plan.skipped
  } else {
    changes = [{ feature_key: body!.feature_key!, is_enabled: body!.is_enabled! }]
  }

  if (changes.length === 0) {
    const { data, error } = await current.supabase
      .from('pharmacy_features')
      .select('feature_key,is_enabled,enabled_at,settings')
      .eq('pharmacy_id', current.pharmacy.id)
      .order('feature_key')

    return error
      ? NextResponse.json({ error: 'Could not load features' }, { status: 500 })
      : NextResponse.json({ features: data ?? [], changed: [], skipped })
  }

  const { data, error } = await current.supabase.rpc('set_authenticated_pharmacy_features', {
    p_changes: changes,
    p_current_code: body?.currentCode ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  if (data?.success === false) {
    const status = data.code === 'SP_LOCKED' ? 423
      : typeof data.code === 'string' && data.code.startsWith('SP_') ? 403
      : 409
    return NextResponse.json(data, { status })
  }

  return NextResponse.json({
    features: data?.features ?? [],
    changed: changes,
    skipped,
  })
}
