import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { determineImportRouting, parseImportBoolean, parseImportDate } from '@/lib/inventory-import'
import { mapControlledValue, mapDosageForm } from '@/lib/controlled-lookups'
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
    const [{ data: dosageFormRows, error: dosageFormsError }, { data: categoryRows, error: categoriesError }] = await Promise.all([
      supabase.from('dosage_forms').select('name').order('name'),
      supabase.from('product_categories').select('name').order('name'),
    ])
    if (dosageFormsError || categoriesError) {
      throw new Error(`Could not load controlled product values: ${dosageFormsError?.message || categoriesError?.message}`)
    }
    const dosageForms = (dosageFormRows || []).map((entry: { name: string }) => entry.name)
    const categories = (categoryRows || []).map((entry: { name: string }) => entry.name)
    
    // Process matching for all rows
    for (const rawRow of rows) {
      const genericName = rawRow[mapping.name] ? String(rawRow[mapping.name]).trim() : ''
      const brandName = mapping.brand_name && rawRow[mapping.brand_name] ? String(rawRow[mapping.brand_name]).trim() : ''
      const strength = mapping.strength && rawRow[mapping.strength] ? String(rawRow[mapping.strength]).trim() : ''
      const suppliedDosageForm = mapping.dosage_form && rawRow[mapping.dosage_form] ? String(rawRow[mapping.dosage_form]).trim() : ''
      const dosageMapping = mapDosageForm(suppliedDosageForm, dosageForms)
      const dosageForm = dosageMapping.value
      const suppliedCategory = mapping.category && rawRow[mapping.category] ? String(rawRow[mapping.category]).trim() : ''
      const categoryMapping = mapControlledValue(suppliedCategory || 'Others', categories)
      const category = categoryMapping.value
      const packSize = mapping.pack_size && rawRow[mapping.pack_size] ? String(rawRow[mapping.pack_size]).trim() : ''
      const sku = mapping.sku && rawRow[mapping.sku] ? String(rawRow[mapping.sku]).trim() : ''
      const suppliedType = mapping.item_type && rawRow[mapping.item_type]
        ? String(rawRow[mapping.item_type]).trim().toLowerCase()
        : ''
      const suppliedTracksExpiry = mapping.tracks_expiry && rawRow[mapping.tracks_expiry] !== undefined
        ? parseImportBoolean(rawRow[mapping.tracks_expiry])
        : false
      
      // Parse numbers
      const priceRaw = rawRow[mapping.price]
      const price = priceRaw !== undefined && priceRaw !== '' ? Number(String(priceRaw).replace(/[^0-9\.]/g, '')) : null
      
      const quantityRaw = rawRow[mapping.quantity]
      const quantity = quantityRaw !== undefined && quantityRaw !== '' ? Number(String(quantityRaw).replace(/[^0-9]/g, '')) : null
      const unitCostRaw = mapping.unit_cost ? rawRow[mapping.unit_cost] : 0
      const unitCost = unitCostRaw !== undefined && unitCostRaw !== '' ? Number(String(unitCostRaw).replace(/[^0-9\.]/g, '')) : 0
      
      const batchNumber = mapping.batch_number && rawRow[mapping.batch_number] ? String(rawRow[mapping.batch_number]).trim() : ''
      const expiryDateRaw = mapping.expiry_date && rawRow[mapping.expiry_date] ? rawRow[mapping.expiry_date] : ''

      // Parse date robustly
      const expiryDate = parseImportDate(expiryDateRaw)

      // Query RPC match
      let matches: any[] = []
      if (genericName || brandName) {
        const { data, error } = await supabase.rpc('match_catalogue_product_for_import', {
          p_generic_name: genericName,
          p_brand_name: brandName || null,
          p_strength: strength || null,
          p_dosage_form: dosageForm || null,
        })
        if (!error && data) {
          matches = data
        } else if (error?.code === 'PGRST202' || error?.code === '42883') {
          const searchQuery = brandName ? `${brandName} ${genericName}` : genericName
          const fallback = await supabase.rpc('match_catalogue_product', { search_query: searchQuery })
          matches = (fallback.data || []).map((match: any) => ({
            ...match,
            confidence: Math.min(Number(match.confidence), 0.49),
            strength_match: null,
            form_match: null,
            mismatch_reasons: ['strength/form compatibility not verified'],
          }))
        } else if (error) {
          throw new Error(`Catalogue matching failed: ${error.message}`)
        }
      }
      const normalizedType = ['medicine', 'drug', 'rx'].includes(suppliedType)
        ? 'medicine'
        : ['store', 'grocery', 'frontstore'].includes(suppliedType) ? 'store' : ''

      // Build the preliminary mapped fields for routing analysis
      const preliminaryMapped: Record<string, unknown> = {
        item_type: normalizedType,
        strength,
        dosage_form: dosageForm,
      }

      // 3-outcome routing: confident match → medicine, medicine signals →
      // create_new, otherwise → store. Explicit CSV type=medicine is NEVER
      // routed to Store.
      const routing = determineImportRouting(preliminaryMapped, matches[0])
      const tracksExpiry = routing.itemType === 'medicine' ? true : suppliedTracksExpiry

      matchedRows.push({
        mapped: {
          generic_name: genericName,
          brand_name: brandName,
          strength,
          dosage_form: dosageForm,
          category,
          pack_size: packSize,
          sku,
          item_type: routing.itemType,
          tracks_expiry: tracksExpiry,
          price,
          quantity,
          unit_cost: unitCost,
          batch_number: batchNumber,
          expiry_date: expiryDate
        },
        selected_product_id: routing.selectedProductId,
        matches
      })
    }

    return NextResponse.json({ matchedRows, dosageForms, categories })
  } catch (error: any) {
    console.error('Match matching error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error while matching products' },
      { status: 500 }
    )
  }
}
