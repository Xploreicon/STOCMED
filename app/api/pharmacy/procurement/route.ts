import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getContext() {
  const supabase = (await createClient()) as any
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 } as const
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return { error: 'Pharmacy profile not found', status: 404 } as const
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
    const query = request.nextUrl.searchParams.get('q')?.trim() || ''
    let builder = supabase.from('products')
      .select('id,generic_name,brand_name,strength,dosage_form,pack_size,barcode')
      .order('generic_name').limit(100)
    if (query) builder = builder.or(`generic_name.ilike.%${query}%,brand_name.ilike.%${query}%,barcode.eq.${query}`)
    let storeBuilder = supabase.from('pharmacy_inventory')
      .select('id,item_name,brand,barcode,unit_description,store_category,tracks_expiry')
      .eq('pharmacy_id', pharmacy.id).eq('item_type', 'store').is('deleted_at', null).limit(100)
    if (query) storeBuilder = storeBuilder.or(`item_name.ilike.%${query}%,brand.ilike.%${query}%,barcode.eq.${query}`)
    const [catalogueResult, storeResult] = await Promise.all([builder, storeBuilder])
    if (catalogueResult.error || storeResult.error) {
      return NextResponse.json({ error: catalogueResult.error?.message || storeResult.error?.message }, { status: 500 })
    }
    const products = [
      ...(catalogueResult.data || []).map((product: any) => ({
        ...product, target_type: 'medicine', product_id: product.id,
        inventory_id: null, tracks_expiry: true,
      })),
      ...(storeResult.data || []).map((item: any) => ({
        id: item.id, target_type: 'store', product_id: null, inventory_id: item.id,
        generic_name: item.item_name, brand_name: item.brand,
        strength: item.unit_description || '', dosage_form: item.store_category,
        pack_size: item.unit_description, barcode: item.barcode,
        tracks_expiry: item.tracks_expiry,
      })),
    ]
    return NextResponse.json({ products })
  }

  if (view === 'orders') {
    const { data, error } = await supabase.from('purchase_orders').select(`
      *, suppliers(id,name,phone,email),
      purchase_order_items(
        *,
        products(id,generic_name,brand_name,strength,dosage_form,pack_size,barcode),
        pharmacy_inventory:inventory_id(id,item_name,brand,barcode,unit_description,store_category,tracks_expiry)
      )
    `).eq('pharmacy_id', pharmacy.id).order('created_at', { ascending: false })
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ orders: data || [] })
  }

  if (view === 'receipts') {
    const { data, error } = await supabase.from('goods_receipts').select(`
      *, suppliers(id,name), purchase_orders(id,po_number),
      goods_receipt_items(
        *,
        products(id,generic_name,brand_name,strength),
        pharmacy_inventory:inventory_id(id,item_name,brand,unit_description,store_category,tracks_expiry),
        batches(id,batch_number,expiry_date)
      )
    `).eq('pharmacy_id', pharmacy.id).order('received_at', { ascending: false }).limit(50)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ receipts: data || [] })
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
  const { supabase, pharmacy } = context

  try {
    const body = await request.json()
    const action = body.action

    if (action === 'supplier_create') {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return NextResponse.json({ error: 'Supplier name is required' }, { status: 400 })
      }
      const { data, error } = await supabase.from('suppliers').insert({
        pharmacy_id: pharmacy.id,
        name: body.name.trim(),
        contact_person: body.contact_person?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        address: body.address?.trim() || null,
        payment_terms: body.payment_terms?.trim() || null,
        notes: body.notes?.trim() || null,
      }).select('*').single()
      return error ? NextResponse.json({ error: error.message }, { status: 409 }) : NextResponse.json({ supplier: data }, { status: 201 })
    }

    if (action === 'supplier_update') {
      if (typeof body.id !== 'string') return NextResponse.json({ error: 'Supplier ID is required' }, { status: 400 })
      const allowed = ['name', 'contact_person', 'phone', 'email', 'address', 'payment_terms', 'notes', 'is_active']
      const updates = Object.fromEntries(allowed.filter(key => key in body).map(key => [key, body[key]]))
      const { data, error } = await supabase.from('suppliers').update(updates)
        .eq('id', body.id).eq('pharmacy_id', pharmacy.id).select('*').single()
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ supplier: data })
    }

    if (action === 'po_create') {
      if (typeof body.supplier_id !== 'string' || !Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json({ error: 'Supplier and at least one catalogue item are required' }, { status: 400 })
      }
      const { data, error } = await supabase.rpc('create_purchase_order', {
        p_pharmacy_id: pharmacy.id,
        p_supplier_id: body.supplier_id,
        p_expected_date: body.expected_date || null,
        p_notes: body.notes || '',
        p_items: body.items,
      })
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ purchase_order_id: data }, { status: 201 })
    }

    if (action === 'po_status') {
      if (!['sent', 'cancelled'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid purchase order status transition' }, { status: 400 })
      }
      let builder = supabase.from('purchase_orders').update({ status: body.status, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('pharmacy_id', pharmacy.id)
      builder = body.status === 'sent' ? builder.eq('status', 'draft') : builder.in('status', ['draft', 'sent'])
      const { data, error } = await builder.select('id,status').single()
      return error ? NextResponse.json({ error: error.message }, { status: 409 }) : NextResponse.json({ order: data })
    }

    if (action === 'receive') {
      if (typeof body.supplier_id !== 'string' || !Array.isArray(body.lines) || body.lines.length === 0) {
        return NextResponse.json({ error: 'Supplier and receiving lines are required' }, { status: 400 })
      }
      const { data, error } = await supabase.rpc('receive_goods', {
        p_pharmacy_id: pharmacy.id,
        p_supplier_id: body.supplier_id,
        p_po_id: body.po_id || null,
        p_notes: body.notes || '',
        p_lines: body.lines,
      })
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 })
    }

    return NextResponse.json({ error: 'Unknown procurement action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Procurement request failed' }, { status: 500 })
  }
}
