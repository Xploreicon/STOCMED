import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { validateRows, type ImportRow } from '@/lib/validation/import-rows'
import { quickBooksImportSchema } from '@/lib/validation/reporting'

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pharmacy = await ensurePharmacyRecord(supabase, user)
    if (!pharmacy) {
      return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
    }

    const body = await request.json()
    if (body?.source === 'quickbooks') {
      const parsed = quickBooksImportSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({
          error: 'QuickBooks rows require a catalogue match, quantity, cost, and price',
          issues: parsed.error.issues,
        }, { status: 422 })
      }
      if (parsed.data.validate_only) return NextResponse.json({ valid: true, rowErrors: [] })
      const { data, error } = await supabase.rpc('stage_quickbooks_import', {
        p_pharmacy_id: pharmacy.id,
        p_rows: parsed.data.matchedRows,
      })
      if (error) return NextResponse.json({ error: `QuickBooks import rolled back: ${error.message}` }, { status: 409 })
      return NextResponse.json({ imported: data.staged, total: data.staged, expiry_capture_required: true }, { status: 201 })
    }
    if (!Array.isArray(body.matchedRows) || body.matchedRows.length === 0) {
      return NextResponse.json({ error: 'matchedRows must be a non-empty array' }, { status: 400 })
    }

    const rowErrors = validateRows(body.matchedRows)
    const selectedProductIds = Array.from(new Set(
      body.matchedRows
        .map((row: ImportRow) => row.selected_product_id)
        .filter((id: unknown): id is string => typeof id === 'string')
    ))

    if (selectedProductIds.length) {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('id')
        .in('id', selectedProductIds)

      if (productError) {
        return NextResponse.json({ error: 'Could not validate catalogue selections' }, { status: 500 })
      }

      const existingIds = new Set((products || []).map((product: { id: string }) => product.id))
      body.matchedRows.forEach((row: ImportRow, index: number) => {
        if (row.selected_product_id && !existingIds.has(row.selected_product_id)) {
          const existingError = rowErrors.find((entry) => entry.row === index + 1)
          if (existingError) existingError.errors.push('Selected catalogue product does not exist')
          else rowErrors.push({ row: index + 1, errors: ['Selected catalogue product does not exist'] })
        }
      })
    }

    if (rowErrors.length) {
      return NextResponse.json(
        { error: 'Import validation failed; no rows were committed', rowErrors },
        { status: 422 }
      )
    }

    if (body.validate_only === true) {
      return NextResponse.json({ valid: true, rowErrors: [] })
    }

    const { data, error } = await supabase.rpc('import_inventory_file', {
      p_pharmacy_id: pharmacy.id,
      p_user_id: user.id,
      p_rows: body.matchedRows,
    })

    if (error) {
      return NextResponse.json(
        { error: `Import rolled back: ${error.message}`, rowErrors: [] },
        { status: 409 }
      )
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Import commit failed')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error committing import' },
      { status: 500 }
    )
  }
}
