import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { reviewOnboardingRows } from '@/lib/onboarding-import'

const requestSchema = z.object({
  file_name: z.string().min(1).max(240),
  raw_rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
  rows: z.array(z.object({
    source_row_number: z.number().int().positive(),
    mapped: z.record(z.string(), z.unknown()),
    selected_product_id: z.string().nullable().optional(),
    parse_error: z.string().optional(),
  }).passthrough()).min(1).max(10000),
  commit: z.boolean().default(false),
})

async function context() {
  const supabase = (await createClient()) as any
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return { error: NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 }) }
  return { supabase, pharmacy }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await context()
    if (ctx.error) return ctx.error
    const id = request.nextUrl.searchParams.get('id')
    if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    let query = ctx.supabase.from('pharmacy_onboarding_batches')
      .select(id ? '*' : 'id,file_name,imported_source_rows,created_at,updated_at')
      .eq('pharmacy_id', ctx.pharmacy.id)
    query = id ? query.eq('id', id).single() : query.order('updated_at', { ascending: false }).limit(20)
    const [{ data, error }, forms, categories] = await Promise.all([
      query,
      ctx.supabase.from('dosage_forms').select('name').order('name'),
      ctx.supabase.from('product_categories').select('name').order('name'),
    ])
    if (error || forms.error || categories.error) throw new Error('Could not load saved onboarding batches')
    return NextResponse.json({ [id ? 'batch' : 'batches']: data, dosageForms: forms.data.map((r: { name: string }) => r.name), categories: categories.data.map((r: { name: string }) => r.name) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load onboarding' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await context()
    if (ctx.error) return ctx.error
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'A complete source file and review rows are required' }, { status: 400 })
    const { rows, raw_rows, file_name, commit } = parsed.data
    if (rows.length !== raw_rows.length || new Set(rows.map((r) => r.source_row_number)).size !== rows.length) {
      return NextResponse.json({ error: 'Every source row must be retained exactly once' }, { status: 400 })
    }
    const [forms, categories] = await Promise.all([
      ctx.supabase.from('dosage_forms').select('name'), ctx.supabase.from('product_categories').select('name'),
    ])
    if (forms.error || categories.error) throw new Error('Could not validate controlled product values')
    // Existing free-text stock can omit strength/form (e.g. "Brand" versus
    // "Brand Tablets 50mg"). Hold possible overlaps; never merge on this hint.
    const existingItemNames: string[] = []
    for (let offset = 0; ; offset += 1000) {
      const inventory = await ctx.supabase.from('pharmacy_inventory').select('item_name,brand')
        .eq('pharmacy_id', ctx.pharmacy.id).is('deleted_at', null).order('id').range(offset, offset + 999)
      if (inventory.error) throw new Error('Could not check existing stock before onboarding')
      for (const item of inventory.data) {
        if (item.item_name) existingItemNames.push(item.item_name)
        if (item.brand) existingItemNames.push(item.brand)
      }
      if (inventory.data.length < 1000) break
    }
    const reviewed = reviewOnboardingRows(rows, {
      dosageForms: forms.data.map((r: { name: string }) => r.name),
      categories: categories.data.map((r: { name: string }) => r.name),
    }, existingItemNames)
    const { data, error } = await ctx.supabase.rpc('save_pharmacy_onboarding', {
      p_pharmacy_id: ctx.pharmacy.id, p_file_name: file_name,
      p_source_rows: raw_rows, p_review_rows: reviewed, p_commit: commit,
      p_sp_token: request.headers.get('x-sp-authorization'),
    })
    if (error) throw new Error(error.message)
    if (data?.success !== true || data.saved !== rows.length
      || data.imported_total + data.existing + data.pending !== data.saved) {
      throw new Error('Onboarding result could not be reconciled')
    }
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save onboarding' }, { status: 409 })
  }
}
