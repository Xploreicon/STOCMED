import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { validateRows, type ImportRow } from '@/lib/validation/import-rows'
import { quickBooksImportSchema } from '@/lib/validation/reporting'
import { normalizeImportDosageForm, normalizeImportStrength } from '@/lib/inventory-import'

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

    const [{ data: dosageFormRows, error: dosageFormsError }, { data: categoryRows, error: categoriesError }] = await Promise.all([
      supabase.from('dosage_forms').select('name'),
      supabase.from('product_categories').select('name'),
    ])
    if (dosageFormsError || categoriesError) {
      return NextResponse.json({ error: 'Could not validate controlled product values' }, { status: 500 })
    }
    const lookups = {
      dosageForms: (dosageFormRows || []).map((entry: { name: string }) => entry.name),
      categories: (categoryRows || []).map((entry: { name: string }) => entry.name),
    }
    const rowErrors = validateRows(body.matchedRows, lookups)
    // Filter out 'create_new' and empty strings — only real UUIDs should be queried against products
    const selectedProductIds = Array.from(new Set(
      body.matchedRows
        .map((row: ImportRow) => row.selected_product_id)
        .filter((id: unknown): id is string =>
          typeof id === 'string' &&
          id.trim() !== '' &&
          id !== 'create_new'
        )
    ))

    if (selectedProductIds.length) {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('id,strength,dosage_form')
        .in('id', selectedProductIds)

      if (productError) {
        console.error('Failed to validate catalogue selections:', productError)
        return NextResponse.json(
          { error: `Could not validate catalogue selections: ${productError.message}` },
          { status: 500 }
        )
      }

      type CatalogueSelection = {
        id: string
        strength: string | null
        dosage_form: string | null
      }
      const productsById = new Map<string, CatalogueSelection>(
        (products || []).map((product: CatalogueSelection) => [product.id, product])
      )
      body.matchedRows.forEach((row: ImportRow, index: number) => {
        // Skip create_new and unselected/store rows
        if (!row.selected_product_id || row.selected_product_id === 'create_new') return
        const selected = productsById.get(row.selected_product_id)
        const errors: string[] = []
        if (!selected) {
          errors.push('Selected catalogue product does not exist')
        } else if (row.mapped?.item_type !== 'store') {
          if (normalizeImportStrength(selected.strength) !== normalizeImportStrength(row.mapped?.strength)) {
            errors.push(`Selected catalogue strength differs (${selected.strength || 'missing'} vs ${String(row.mapped?.strength || 'missing')})`)
          }
          if (normalizeImportDosageForm(selected.dosage_form) !== normalizeImportDosageForm(row.mapped?.dosage_form)) {
            errors.push(`Selected catalogue form differs (${selected.dosage_form || 'missing'} vs ${String(row.mapped?.dosage_form || 'missing')})`)
          }
        }
        if (errors.length) {
          const existingError = rowErrors.find((entry) => entry.row === index + 1)
          if (existingError) existingError.errors.push(...errors)
          else rowErrors.push({ row: index + 1, errors })
        }
      })
    }

    if (rowErrors.length) {
      console.error('Import validation failed:', JSON.stringify(rowErrors))
      return NextResponse.json(
        { error: `Import validation failed on ${rowErrors.length} row(s); no rows were committed`, rowErrors },
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
      console.error('import_inventory_file RPC failed:', error)
      return NextResponse.json(
        { error: `Import rolled back: ${error.message}`, rowErrors: [] },
        { status: 409 }
      )
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Import commit failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error committing import' },
      { status: 500 }
    )
  }
}
