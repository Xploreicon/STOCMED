import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { SP_ACTIONS } from '@/lib/sp-authorization'
import { getPharmacySpConfig } from '@/lib/pharmacy-sp-config'

const SP_GATE_ACTIONS = [
  'large_discount',
  'price_change',
  'stock_adjustment',
  'delist_inventory',
  'restore_inventory',
  'void_or_refund',
  'pharmacy_settings',
  'financial_reports',
  'data_export',
  'staff_accounts',
] as const

const authorizeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  action: z.enum(SP_ACTIONS),
  target: z.string().trim().max(300).optional(),
})

const setCodeSchema = z.object({
  operation: z.literal('set_code').optional(),
  newCode: z.string().regex(/^\d{6}$/),
  currentCode: z.string().regex(/^\d{6}$/).optional(),
})
const setGatesSchema = z.object({
  operation: z.literal('set_gates'),
  currentCode: z.string().regex(/^\d{6}$/).nullable().optional(),
  gates: z.record(z.string(), z.boolean()).refine(
    gates => Object.keys(gates).length > 0
      && Object.keys(gates).every(key => (SP_GATE_ACTIONS as readonly string[]).includes(key)),
    'Choose at least one valid action gate.',
  ),
})
const configureSchema = z.union([setCodeSchema, setGatesSchema])
const removeCodeSchema = z.object({
  currentCode: z.string().regex(/^\d{6}$/),
})
const settingsSchema = z.object({
  discountThreshold: z.coerce.number().min(0).max(100),
  graceMinutes: z.coerce.number().int().min(1).max(15),
  requireFinancialReports: z.boolean(),
  currentCode: z.string().regex(/^\d{6}$/),
})

type RpcResult = {
  success?: boolean
  code?: string
  error?: string
  [key: string]: unknown
}

function rpcFailure(data: unknown, fallback: string) {
  const result = data as RpcResult | null
  if (!result || result.success !== false) return null
  const status = result.code === 'SP_LOCKED' ? 423
    : result.code?.startsWith('SP_') ? 403
    : result.code === 'NOT_FOUND' ? 404
    : 409
  return NextResponse.json({ ...result, error: result.error || fallback }, { status })
}

export async function GET() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })

  const [settingsResult, { data: audit }, { data: gates, error: gatesError }] = await Promise.all([
    getPharmacySpConfig(pharmacy.id),
    supabase.from('sp_authorization_audit')
      .select('id,actor_user_id,action,target_description,succeeded,failure_reason,created_at')
      .eq('pharmacy_id', pharmacy.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('pharmacy_sp_action_gates')
      .select('action_key,is_gated,updated_at')
      .eq('pharmacy_id', pharmacy.id)
      .order('action_key'),
  ])
  if (settingsResult.error || !settingsResult.data || gatesError) {
    return NextResponse.json({ error: 'SP settings are temporarily unavailable' }, { status: 503 })
  }
  const settings = settingsResult.data

  return NextResponse.json({
    configured: settings.configured,
    discountThreshold: settings.discountThreshold,
    graceMinutes: settings.graceMinutes,
    requireFinancialReports: settings.requireFinancialReports,
    lockedUntil: settings.lockedUntil,
    gates: gates ?? [],
    audit: audit ?? [],
  })
}

export async function POST(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const parsed = authorizeSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit superintendent code.' }, { status: 400 })

  const { data, error } = await supabase.rpc('authorize_sp_action', {
    p_pharmacy_id: pharmacy.id,
    p_code: parsed.data.code,
    p_action: parsed.data.action,
    p_target_description: parsed.data.target ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  if (typeof data === 'string' && data.startsWith('__ERROR__:')) {
    return NextResponse.json({ error: data.slice('__ERROR__:'.length) }, { status: 403 })
  }
  return NextResponse.json({ token: data })
}

export async function PUT(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const parsed = configureSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid SP configuration.' }, { status: 400 })
  }

  const rpcArgs = parsed.data.operation === 'set_gates'
    ? {
        p_operation: 'set_gates',
        p_new_code: null,
        p_current_code: parsed.data.currentCode ?? null,
        p_gate_updates: parsed.data.gates,
      }
    : {
        p_operation: 'set_code',
        p_new_code: parsed.data.newCode,
        p_current_code: parsed.data.currentCode ?? null,
        p_gate_updates: null,
      }
  const { data, error } = await supabase.rpc('configure_sp_authorization', rpcArgs)
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  const failure = rpcFailure(data, 'Could not update superintendent configuration.')
  return failure ?? NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const parsed = removeCodeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the current 6-digit superintendent code.' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('configure_sp_authorization', {
    p_operation: 'remove_code',
    p_new_code: null,
    p_current_code: parsed.data.currentCode,
    p_gate_updates: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  const failure = rpcFailure(data, 'Could not remove the superintendent code.')
  return failure ?? NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { data, error } = await supabase.rpc('update_sp_authorization_settings', {
    p_discount_threshold: parsed.data.discountThreshold,
    p_grace_minutes: parsed.data.graceMinutes,
    p_require_financial_reports: parsed.data.requireFinancialReports,
    p_current_code: parsed.data.currentCode,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const failure = rpcFailure(data, 'Could not update superintendent controls.')
  return failure ?? NextResponse.json(data)
}
