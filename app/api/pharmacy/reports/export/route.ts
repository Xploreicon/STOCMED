import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { exportQuerySchema } from '@/lib/validation/reporting'

export const dynamic = 'force-dynamic'

type ExportSale = {
  id: string
  created_at: string
  payment_method: string
  total: number
  sale_items: Array<{
    quantity: number
    unit_price: number
    line_total: number
    batches: { batch_number: string; cost_price: number | null } | null
    pharmacy_inventory: { products: { generic_name: string; brand_name: string | null; strength: string; dosage_form: string | null; barcode: string | null } | null } | null
  }>
}

export async function GET(request: NextRequest) {
  const parsed = exportQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const supabase = (await createClient()) as any
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })

  const to = parsed.data.to ?? new Date().toISOString().slice(0, 10)
  const from = parsed.data.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const [salesResult, reportsResult] = await Promise.all([
    supabase.from('sales').select(`
      id,created_at,payment_method,total,
      sale_items(quantity,unit_price,line_total,batches(batch_number,cost_price),
        pharmacy_inventory(products(generic_name,brand_name,strength,dosage_form,barcode)))
    `).eq('pharmacy_id', pharmacy.id).eq('status', 'completed')
      .gte('created_at', `${from}T00:00:00.000Z`).lt('created_at', `${to}T23:59:59.999Z`)
      .order('created_at'),
    supabase.rpc('get_pharmacy_reports', { p_pharmacy_id: pharmacy.id, p_from: from, p_to: to }),
  ])
  if (salesResult.error || reportsResult.error) {
    return NextResponse.json({ error: salesResult.error?.message || reportsResult.error?.message }, { status: 500 })
  }

  const salesRows = ((salesResult.data ?? []) as ExportSale[]).flatMap(sale => sale.sale_items.map(item => {
    const product = item.pharmacy_inventory?.products
    const cogs = Number(item.quantity) * Number(item.batches?.cost_price ?? 0)
    return {
      Date: sale.created_at,
      'Receipt No': sale.id,
      Product: product?.brand_name || product?.generic_name || 'Unknown product',
      Description: [product?.generic_name, product?.strength, product?.dosage_form].filter(Boolean).join(' '),
      SKU: product?.barcode || '',
      'Batch No': item.batches?.batch_number || '',
      Quantity: Number(item.quantity),
      'Unit Price': Number(item.unit_price),
      Sales: Number(item.line_total),
      COGS: cogs,
      Margin: Number(item.line_total) - cogs,
      'Payment Method': sale.payment_method,
    }
  }))
  const valuationRows = reportsResult.data?.stock_valuation ?? []

  if (parsed.data.format === 'csv') {
    const rows = parsed.data.dataset === 'valuation' ? valuationRows : salesRows
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stocmed-${parsed.data.dataset}-${from}-to-${to}.csv"`,
      },
    })
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesRows), 'Sales and COGS')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(valuationRows), 'Stock Valuation')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="stocmed-quickbooks-bridge-${from}-to-${to}.xlsx"`,
    },
  })
}
