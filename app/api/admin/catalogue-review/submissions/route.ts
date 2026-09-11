import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') || '25', 10) || 25))
  const search = (request.nextUrl.searchParams.get('q') || '').trim().replace(/[,%()]/g, ' ')

  let query = (access.supabase as any)
    .from('products')
    .select('id,generic_name,brand_name,manufacturer,strength,dosage_form,category,pack_size,nafdac_number,barcode,requires_prescription,created_at', { count: 'exact' })
    .eq('is_verified', false)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)
  if (search) {
    query = query.or(`generic_name.ilike.%${search}%,brand_name.ilike.%${search}%,nafdac_number.ilike.%${search}%`)
  }

  const [{ data: products, count, error }, { data: dosageForms }, { data: categories }] = await Promise.all([
    query,
    (access.supabase as any).from('dosage_forms').select('name').order('name'),
    (access.supabase as any).from('product_categories').select('name').order('name'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    products: products || [],
    total: count || 0,
    page,
    limit,
    dosage_forms: (dosageForms || []).map((row: { name: string }) => row.name),
    categories: (categories || []).map((row: { name: string }) => row.name),
  }, { headers: { 'Cache-Control': 'no-store, private' } })
}
