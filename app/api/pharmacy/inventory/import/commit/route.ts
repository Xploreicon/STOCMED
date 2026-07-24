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

    const rowErrors = validateRows(body.matchedRows)
    // Filter out 'create_new' — those will be resolved to real product IDs
    // after validation passes, right before the commit.
    const selectedProductIds = Array.from(new Set(
      body.matchedRows
        .map((row: ImportRow) => row.selected_product_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id !== 'create_new')
    ))

    if (selectedProductIds.length) {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('id,strength,dosage_form')
        .in('id', selectedProductIds)

      if (productError) {
        return NextResponse.json({ error: 'Could not validate catalogue selections' }, { status: 500 })
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
        // Skip create_new rows — they have no existing product to validate against
        if (row.selected_product_id === 'create_new') return
        const selected = row.selected_product_id ? productsById.get(row.selected_product_id) : null
        const errors: string[] = []
        if (row.selected_product_id && !selected) {
          errors.push('Selected catalogue product does not exist')
        } else if (selected && row.mapped?.item_type !== 'store') {
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
      return NextResponse.json(
        { error: 'Import validation failed; no rows were committed', rowErrors },
        { status: 422 }
      )
    }

    if (body.validate_only === true) {
      return NextResponse.json({ valid: true, rowErrors: [] })
    }

    // Resolve 'create_new' rows: create unverified catalogue products and
    // replace 'create_new' with the real product UUID before import.
    for (const row of body.matchedRows) {
      if (row.selected_product_id !== 'create_new') continue
      const mapped = row.mapped ?? {}
      const { data: newProduct, error: createError } = await supabase.rpc(
        'create_unverified_catalog_product',
        {
          p_pharmacy_id: pharmacy.id,
          p_generic_name: String(mapped.generic_name || ''),
          p_brand_name: String(mapped.brand_name || '') || null,
          p_manufacturer: null,
          p_strength: String(mapped.strength || ''),
          p_dosage_form: String(mapped.dosage_form || ''),
          p_category: String(mapped.category || 'Uncategorised'),
          p_pack_size: String(mapped.pack_size || '') || null,
          p_image_url: null,
        }
      )
      if (createError || !newProduct) {
        return NextResponse.json(
          { error: `Failed to create catalogue product for "${mapped.generic_name}": ${createError?.message || 'unknown error'}` },
          { status: 409 }
        )
      }
      row.selected_product_id = newProduct.id
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
