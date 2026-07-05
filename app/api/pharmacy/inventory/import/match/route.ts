import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

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

    const body = await request.json()
    const { rows, mapping } = body

    if (!rows || !mapping) {
      return NextResponse.json(
        { error: 'Missing rows or mapping configuration' },
        { status: 400 }
      )
    }

    const matchedRows: any[] = []
    
    // Process matching for all rows
    for (const rawRow of rows) {
      const genericName = rawRow[mapping.name] ? String(rawRow[mapping.name]).trim() : ''
      const brandName = mapping.brand_name && rawRow[mapping.brand_name] ? String(rawRow[mapping.brand_name]).trim() : ''
      const strength = mapping.strength && rawRow[mapping.strength] ? String(rawRow[mapping.strength]).trim() : ''
      const dosageForm = mapping.dosage_form && rawRow[mapping.dosage_form] ? String(rawRow[mapping.dosage_form]).trim() : ''
      const category = mapping.category && rawRow[mapping.category] ? String(rawRow[mapping.category]).trim() : ''
      const packSize = mapping.pack_size && rawRow[mapping.pack_size] ? String(rawRow[mapping.pack_size]).trim() : ''
      
      // Parse numbers
      const priceRaw = rawRow[mapping.price]
      const price = priceRaw !== undefined && priceRaw !== '' ? Number(String(priceRaw).replace(/[^0-9\.]/g, '')) : null
      
      const quantityRaw = rawRow[mapping.quantity]
      const quantity = quantityRaw !== undefined && quantityRaw !== '' ? Number(String(quantityRaw).replace(/[^0-9]/g, '')) : null
      
      const batchNumber = mapping.batch_number && rawRow[mapping.batch_number] ? String(rawRow[mapping.batch_number]).trim() : ''
      const expiryDateRaw = mapping.expiry_date && rawRow[mapping.expiry_date] ? rawRow[mapping.expiry_date] : ''

      // Parse date robustly
      let expiryDate = ''
      if (expiryDateRaw) {
        if (typeof expiryDateRaw === 'number') {
          // SheetJS date serial number
          const date = new Date((expiryDateRaw - 25569) * 86400 * 1000)
          expiryDate = date.toISOString().split('T')[0]
        } else {
          // Try parsing standard formats
          const str = String(expiryDateRaw).trim()
          const parsed = Date.parse(str)
          if (!isNaN(parsed)) {
            expiryDate = new Date(parsed).toISOString().split('T')[0]
          } else {
            expiryDate = str // Keep raw if not parseable for Step 3 validation
          }
        }
      }

      // Query RPC match
      let matches: any[] = []
      if (genericName || brandName) {
        const searchQuery = brandName ? `${brandName} ${genericName}` : genericName
        const { data, error } = await supabase.rpc('match_catalogue_product', {
          search_query: searchQuery
        })
        if (!error && data) {
          matches = data
        }
      }

      matchedRows.push({
        mapped: {
          generic_name: genericName,
          brand_name: brandName,
          strength,
          dosage_form: dosageForm,
          category,
          pack_size: packSize,
          price,
          quantity,
          batch_number: batchNumber,
          expiry_date: expiryDate
        },
        matches
      })
    }

    return NextResponse.json({ matchedRows })
  } catch (error: any) {
    console.error('Match matching error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error while matching products' },
      { status: 500 }
    )
  }
}
