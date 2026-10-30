import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'
import { getStructuredRpcFailure } from '@/lib/sp-authorization'

export const dynamic = 'force-dynamic'

async function getContext() {
  const supabase = (await createClient()) as any
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 } as const
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return { error: 'Pharmacy profile not found', status: 404 } as const
  const featureError = await requirePharmacyFeature(supabase, pharmacy.id, 'purchase_orders_and_receiving')
  if (featureError) return { error: featureError.error, code: featureError.code, status: 403 } as const
  return { supabase, user, pharmacy } as const
}

export async function GET(request: NextRequest) {
  const context = await getContext()
  if ('error' in context) return NextResponse.json({ error: context.error }, { status: context.status })
  const { supabase, pharmacy } = context
  const view = request.nextUrl.searchParams.get('view') || 'overview'

  if (view === 'suppliers') {
    const { data, error } = await supabase.from('suppliers').select('*')
      .eq('pharmacy_id', pharmacy.id).order('is_active', { ascending: false }).order('name')
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ suppliers: data || [] })
  }

  if (view === 'products') {
    const query = (request.nextUrl.searchParams.get('q') || '').trim().slice(0,120).replace(/[,%()]/g, ' ')
    const page = Math.max(0, Math.min(10000, Number(request.nextUrl.searchParams.get('page')) || 0))
    const offset = Math.floor(page) * 25
    let builder = supabase.from('products')
      .select('id,generic_name,brand_name,strength,dosage_form,pack_size,barcode')
      .order('generic_name').order('id').range(offset, offset + 25)
    if (query) builder = builder.or(`generic_name.ilike.%${query}%,brand_name.ilike.%${query}%,strength.ilike.%${query}%,barcode.eq.${query}`)
    let storeBuilder = supabase.from('pharmacy_inventory')
      .select('id,item_name,brand,barcode,unit_description,store_category,tracks_expiry,price,base_unit_name,deleted_at,recovery_expires_at')
      .eq('pharmacy_id', pharmacy.id).eq('item_type', 'store')
      .order('item_name').order('id').range(offset, offset + 25)
    if (query) storeBuilder = storeBuilder.or(`item_name.ilike.%${query}%,brand.ilike.%${query}%,barcode.eq.${query}`)
    const [catalogueResult, storeResult] = await Promise.all([builder, storeBuilder])
    if (catalogueResult.error || storeResult.error) return NextResponse.json({ error: 'Could not search inventory' }, { status: 500 })
    const catalogue = (catalogueResult.data || []).slice(0,25)
    const ids = catalogue.map((item: any) => item.id)
    const owned = ids.length ? await supabase.from('pharmacy_inventory')
      .select('product_id,price,base_unit_name,deleted_at,recovery_expires_at').eq('pharmacy_id',pharmacy.id).in('product_id',ids) : { data: [], error: null }
    if (owned.error) return NextResponse.json({ error: 'Could not load inventory details' }, { status: 500 })
    const products = [
      ...catalogue.map((product: any) => {
        const inventory = owned.data?.find((item: any) => item.product_id === product.id)
        return { ...product, target_type: 'medicine', product_id: product.id, inventory_id: null, tracks_expiry: true,
          is_new: !inventory, base_unit_name: inventory?.base_unit_name, selling_price: inventory?.price, deleted_at: inventory?.deleted_at, recovery_expires_at: inventory?.recovery_expires_at }
      }),
      ...(storeResult.data || []).slice(0,25).map((item: any) => ({
        id: item.id, target_type: 'store', product_id: null, inventory_id: item.id,
        generic_name: item.item_name, brand_name: item.brand,
        strength: item.unit_description || '', dosage_form: item.store_category,
        pack_size: item.unit_description, barcode: item.barcode,
        tracks_expiry: item.tracks_expiry, base_unit_name: item.base_unit_name, selling_price: item.price, is_new: false,
        deleted_at: item.deleted_at, recovery_expires_at: item.recovery_expires_at,
      })),
    ]
    return NextResponse.json({ products, has_more: (catalogueResult.data?.length || 0) > 25 || (storeResult.data?.length || 0) > 25 })
  }

  if (view === 'orders') {
    const { data, error } = await supabase.from('purchase_orders').select(`
      *, suppliers(id,name,phone,email), goods_receipts(reversed_at,goods_receipt_items(line_total)),
      purchase_order_items(
        *,
        products(id,generic_name,brand_name,strength,dosage_form,pack_size,barcode),
        pharmacy_inventory:inventory_id(id,item_name,brand,barcode,unit_description,store_category,tracks_expiry)
      )
    `).eq('pharmacy_id', pharmacy.id).order('created_at', { ascending: false })
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ orders: (data || []).map((order: any) => ({ ...order, received_total: order.goods_receipts.filter((receipt: any) => !receipt.reversed_at).reduce((total: number, receipt: any) => total + receipt.goods_receipt_items.reduce((sum: number, item: any) => sum + Number(item.line_total), 0), 0) })) })
  }

  if (view === 'receipts') {
    const page = Math.floor(Math.max(0,Math.min(10000,Number(request.nextUrl.searchParams.get('page')) || 0)))
    const { data, error } = await supabase.from('goods_receipts').select(`
      *, suppliers(id,name), purchase_orders(id,po_number),
      goods_receipt_items(
        *,
        products(id,generic_name,brand_name,strength),
        pharmacy_inventory:inventory_id(id,item_name,brand,unit_description,store_category,tracks_expiry),
        batches(id,batch_number,expiry_date)
      )
    `).eq('pharmacy_id', pharmacy.id).order('received_at', { ascending: false }).order('id').range(page * 50, page * 50 + 50)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ receipts: (data || []).slice(0,50), has_more: (data?.length || 0) > 50 })
  }

  if (view === 'trace') {
    const query = request.nextUrl.searchParams.get('q')?.trim() || ''
    let builder = supabase.from('batches').select(`
      id,batch_number,expiry_date,quantity_received,cost_price,received_at,
      suppliers(id,name,phone,email),
      purchase_orders(id,po_number),
      pharmacy_inventory!inner(
        pharmacy_id,item_type,item_name,brand,barcode,unit_description,store_category,
        products(id,generic_name,brand_name,strength,nafdac_number,barcode)
      ),
      sale_items(id,sale_id,quantity,sales(created_at,status))
    `).eq('pharmacy_inventory.pharmacy_id', pharmacy.id).order('created_at', { ascending: false }).limit(100)
    if (query) builder = builder.ilike('batch_number', `%${query}%`)
    const { data, error } = await builder
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ batches: data || [] })
  }

  const [suppliers, orders, receipts] = await Promise.all([
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacy.id).eq('is_active', true),
    supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacy.id).in('status', ['draft', 'sent', 'partially_received']),
    supabase.from('goods_receipts').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacy.id),
  ])
  return NextResponse.json({
    supplier_count: suppliers.count || 0,
    open_order_count: orders.count || 0,
    receipt_count: receipts.count || 0,
  })
}

export async function POST(request: NextRequest) {
  const context = await getContext()
  if ('error' in context) return NextResponse.json({ error: context.error }, { status: context.status })
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['supplier_create','supplier_update','po_create','po_update','po_status','receive','receipt_reverse'].includes(body.action)) {
      return NextResponse.json({ error: 'Invalid procurement action' }, { status: 400 })
    }
    const { authorization, ...command } = body
    const tokens = Object.fromEntries(['price_change','restore_inventory','stock_adjustment'].map(key => [key,
      typeof authorization?.[key] === 'string' ? authorization[key] : null]))
    const { data, error } = await context.supabase.rpc('write_procurement', {
      p_pharmacy_id: context.pharmacy.id, p_command: command,
      p_staff_token: request.headers.get('x-staff-session'), p_sp_tokens: tokens,
    })
    if (error) {
      const action = ['price_change','restore_inventory'].includes(error.hint) ? error.hint : null
      const needsSp = action && /[Ss]uperintendent/.test(error.message)
      const duplicate = error.code === '23505'
      return NextResponse.json({
        error: duplicate ? 'This supplier invoice or record already exists. Check receipt history before retrying.' : error.message,
        code: needsSp ? 'SP_AUTH_REQUIRED' : error.code,
        ...(needsSp ? { action } : {}),
      }, { status: needsSp || error.code === '42501' ? 403 : 409 })
    }
    const failure = getStructuredRpcFailure(data, 'Procurement action rejected')
    if (failure) return NextResponse.json(data, { status: failure.code?.startsWith('STAFF_') || failure.code === 'SP_AUTH_REQUIRED' ? 403 : 409 })
    return NextResponse.json(data, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Invalid procurement request' }, { status: 400 })
  }
}
