import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { autoMapImportHeaders, INVENTORY_IMPORT_FIELDS } from '@/lib/inventory-import'
import { normalizeInventoryRows, parseInventoryWorkbook } from '@/lib/inventory-import-parser'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)

    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const { headers, rows } = parseInventoryWorkbook(buffer)

    if (headers.length === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 })
    }

    const suggestedMapping = autoMapImportHeaders(headers, INVENTORY_IMPORT_FIELDS)
    const stagingRows = normalizeInventoryRows(rows, suggestedMapping)
    const parseErrors = stagingRows.filter((row) => row.parse_error).length

    return NextResponse.json({
      headers,
      rows,
      suggestedMapping,
      stagingRows,
      parseSummary: {
        total: stagingRows.length,
        errors: parseErrors,
        valid: stagingRows.length - parseErrors,
        barcodes: stagingRows.filter((row) => row.barcode !== null).length,
      },
    })
  } catch (error: any) {
    console.error('Parse file error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error while parsing file' },
      { status: 500 }
    )
  }
}
