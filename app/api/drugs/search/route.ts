import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { POM_MOLECULES_LIST } from '@/lib/triage/keyword-lists'
import { getDeterministicSafetyRedirect } from '@/lib/triage/deterministic-safety-redirect'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function areDigitalRxReservationsEnabled() {
  return process.env.STAFFED_SAFETY_FLOWS_ENABLED === 'true'
    && process.env.RX_RESERVATIONS_ENABLED === 'true'
}

type ReservationAvailability = {
  inventory_id: string
  reserved_quantity: number
  sellable_quantity: number
}

type ReservationCapability = {
  inventory_id: string
  reservations_enabled: boolean
}

function isMissingReservationRpc(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist/i.test(error.message ?? '')
}

function isKnownPomProduct(product: { generic_name?: string | null; brand_name?: string | null; requires_prescription?: boolean } | null) {
  if (product?.requires_prescription) return true
  const name = `${product?.generic_name ?? ''} ${product?.brand_name ?? ''}`.toLowerCase()
  return POM_MOLECULES_LIST.terms.some((term) => name.includes(term.toLowerCase()))
}

function isPharmacyFullyVerified(pharmacy: Record<string, any> | null) {
  return pharmacy?.verification_status === 'full' && pharmacy?.is_verified === true
}

function isPharmacyVisible(pharmacy: Record<string, any> | null) {
  if (isPharmacyFullyVerified(pharmacy)) return true
  if (pharmacy?.verification_status !== 'provisional' || !pharmacy?.provisional_expires_at) return false
  const deadline = new Date(pharmacy.provisional_expires_at)
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() > Date.now()
}

export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'drug-search', 60, 60_000)
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    const location = searchParams.get('location')
    const category = searchParams.get('category')
    const inStockOnly = searchParams.get('in_stock_only') === 'true'
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')

    const userLatitude = lat ? Number.parseFloat(lat) : NaN
    const userLongitude = lng ? Number.parseFloat(lng) : NaN
    const hasUserCoordinates = Number.isFinite(userLatitude) && Number.isFinite(userLongitude)

    if (!query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      )
    }

    // Search is a public API and must enforce the same deterministic safety
    // boundary as chat. Never query or return inventory for these outcomes.
    const safetyRedirect = getDeterministicSafetyRedirect(query)
    if (safetyRedirect) {
      return NextResponse.json({
        results: [],
        count: 0,
        query,
        safety_redirect: safetyRedirect,
      }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const supabase = await createClient()

    // Query pharmacy_inventory joined with products and pharmacies
    let queryBuilder = supabase
      .from('pharmacy_inventory')
      .select(`
        id,
        price,
        quantity_in_stock,
        low_stock_threshold,
        updated_at,
        created_at,
        image_url,
        products!inner (
          id,
          generic_name,
          brand_name,
          manufacturer,
          strength,
          dosage_form,
          category,
          requires_prescription,
          description,
          image_url
        ),
        pharmacies!inner (
          id,
          pharmacy_name,
          address,
          city,
          state,
          phone,
          license_number,
          is_verified,
          verification_status,
          provisional_expires_at,
          latitude,
          longitude,
          is_active,
          logo_url
        ),
        batches (
          expiry_date
        )
      `)
      .eq('pharmacies.is_active', true)
      .eq('products.is_verified', true)
      .eq('is_listed', true)
      .is('deleted_at', null)
      .or(`search_vector.plfts.${query},generic_name.ilike.%${query}%,brand_name.ilike.%${query}%`, { foreignTable: 'products' })

    // Apply category filter
    if (category) {
      queryBuilder = queryBuilder.eq('products.category', category)
    }

    // Apply in stock filter
    if (inStockOnly) {
      queryBuilder = queryBuilder.gt('quantity_in_stock', 0)
    }

    // Execute query
    let { data: inventory, error } = await queryBuilder

    if (error) {
      console.error('Search error:', error)
          return NextResponse.json(
        { error: 'Failed to search drugs' },
        { status: 500 }
      )
    }

    inventory = (inventory || []).filter((row: any) => isPharmacyVisible(row.pharmacies))

    // Fuzzy search fallback: if no results found, perform a pg_trgm similarity search
    if ((!inventory || inventory.length === 0) && query) {
      const { data: matchedProducts, error: fuzzyError } = await (supabase.rpc as any)('match_catalogue_product', {
        search_query: query
      })

      if (!fuzzyError && matchedProducts && matchedProducts.length > 0) {
        const productIds = matchedProducts
          .filter((p: any) => Number(p.confidence) > 0.3)
          .map((p: any) => p.id)

        if (productIds.length > 0) {
          let fallbackBuilder = supabase
            .from('pharmacy_inventory')
            .select(`
              id,
              price,
              quantity_in_stock,
              low_stock_threshold,
              updated_at,
              created_at,
              image_url,
              products!inner (
                id,
                generic_name,
                brand_name,
                manufacturer,
                strength,
                dosage_form,
                category,
                requires_prescription,
                description,
                image_url
              ),
              pharmacies!inner (
                id,
                pharmacy_name,
                address,
                city,
                state,
                phone,
                license_number,
                is_verified,
                verification_status,
                provisional_expires_at,
                latitude,
                longitude,
                is_active,
                logo_url
              ),
              batches (
                expiry_date
              )
            `)
            .eq('pharmacies.is_active', true)
            .eq('products.is_verified', true)
            .eq('is_listed', true)
            .is('deleted_at', null)
            .in('product_id', productIds)

          if (category) {
            fallbackBuilder = fallbackBuilder.eq('products.category', category)
          }

          if (inStockOnly) {
            fallbackBuilder = fallbackBuilder.gt('quantity_in_stock', 0)
          }

          const { data: fallbackInventory, error: fallbackQueryError } = await fallbackBuilder
          if (!fallbackQueryError && fallbackInventory) {
            inventory = fallbackInventory.filter((row: any) => isPharmacyVisible(row.pharmacies))
          }
        }
      }
    }

    // Holds are soft locks. Public availability must never expose raw ledger stock.
    const inventoryIds = (inventory || []).map((row: any) => row.id)
    const { data: availability, error: availabilityError } = inventoryIds.length
      ? await (supabase.rpc as any)('reservation_sellable_quantities', { p_inventory_ids: inventoryIds })
      : { data: [], error: null }

    if (availabilityError && !isMissingReservationRpc(availabilityError)) {
      console.error('Reservation availability error:', availabilityError)
      return NextResponse.json({ error: 'Failed to calculate medication availability' }, { status: 500 })
    }

    const { data: capabilities, error: capabilityError } = inventoryIds.length
      ? await (supabase.rpc as any)('reservation_inventory_capabilities', { p_inventory_ids: inventoryIds })
      : { data: [], error: null }

    if (capabilityError && !isMissingReservationRpc(capabilityError)) {
      console.error('Reservation capability error:', capabilityError)
      return NextResponse.json({ error: 'Failed to calculate pharmacy reservation availability' }, { status: 500 })
    }

    const sellableByInventoryId = new Map<string, ReservationAvailability>(
      ((availability || []) as ReservationAvailability[]).map((entry) => [entry.inventory_id, entry])
    )
    const reservationsEnabledByInventoryId = new Map<string, boolean>(
      ((capabilities || []) as ReservationCapability[]).map((entry) => [entry.inventory_id, entry.reservations_enabled])
    )

    // Map database results to the old flat 'drugs' schema structure
    let results = (inventory || []).map((row: any) => {
      const price = typeof row.price === 'number' ? row.price : Number(row.price)
      const priceDelta = Number.isFinite(price) ? price * 0.05 : null
      const pharmacy = row.pharmacies
      const product = row.products
      
      let distanceKm: number | null = null

      if (
        hasUserCoordinates &&
        pharmacy?.latitude !== null &&
        pharmacy?.latitude !== undefined &&
        pharmacy?.longitude !== null &&
        pharmacy?.longitude !== undefined
      ) {
        const toRadians = (value: number) => (value * Math.PI) / 180
        const earthRadiusKm = 6371
        const dLat = toRadians(pharmacy.latitude - userLatitude)
        const dLon = toRadians(pharmacy.longitude - userLongitude)
        const lat1 = toRadians(userLatitude)
        const lat2 = toRadians(pharmacy.latitude)

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        distanceKm = Math.round(earthRadiusKm * c * 10) / 10
      }

      // Find earliest expiry date
      const expiryDate = row.batches && row.batches.length > 0
        ? row.batches.map((b: any) => b.expiry_date).sort()[0]
        : null

      const reservationAvailability = sellableByInventoryId.get(row.id)
      const sellableQuantity = reservationAvailability?.sellable_quantity ?? row.quantity_in_stock
      const requiresPrescription = isKnownPomProduct(product)
      const fullyVerifiedPharmacy = isPharmacyFullyVerified(pharmacy)
      const reservationsEnabled = (reservationsEnabledByInventoryId.get(row.id) ?? false)
        && (!requiresPrescription || fullyVerifiedPharmacy)
      const digitalRxEnabled = areDigitalRxReservationsEnabled()

      return {
        id: row.id,
        product_id: product?.id || null,
        pharmacy_id: pharmacy?.id || null,
        name: product?.brand_name || product?.generic_name || '',
        generic_name: product?.generic_name || null,
        brand_name: product?.brand_name || null,
        category: product?.category || '',
        dosage_form: product?.dosage_form || '',
        strength: product?.strength || null,
        description: product?.description || null,
        price: price,
        quantity_in_stock: sellableQuantity,
        reserved_quantity: reservationAvailability?.reserved_quantity ?? 0,
        low_stock_threshold: row.low_stock_threshold,
        requires_prescription: requiresPrescription,
        manufacturer: product?.manufacturer || null,
        expiry_date: expiryDate,
        created_at: row.created_at,
        updated_at: row.updated_at,
        image_url: row.image_url || product?.image_url || null,
        pharmacies: pharmacy ? {
          ...pharmacy,
          reservations_enabled: reservationsEnabled,
          digital_prescription_reservations_enabled: requiresPrescription
            && digitalRxEnabled
            && reservationsEnabled
            && fullyVerifiedPharmacy,
        } : null,
        price_range_min: Number.isFinite(price) ? Math.max(Math.round((price - (priceDelta ?? 0)) / 10) * 10, 0) : null,
        price_range_max: Number.isFinite(price) ? Math.round((price + (priceDelta ?? 0)) / 10) * 10 : null,
        distance_km: distanceKm,
      }
    })

    // Filter by pharmacy location if provided
    if (location) {
      results = results.filter((drug: any) => {
        const pharmacy = drug.pharmacies
        return pharmacy && (
          pharmacy.city?.toLowerCase().includes(location.toLowerCase()) ||
          pharmacy.state?.toLowerCase().includes(location.toLowerCase()) ||
          pharmacy.address?.toLowerCase().includes(location.toLowerCase())
        )
      })
    }

    if (inStockOnly) {
      results = results.filter((drug: any) => drug.quantity_in_stock > 0)
    }

    if (hasUserCoordinates) {
      results = results.sort((a: any, b: any) => {
        const distanceA = Number.isFinite(a.distance_km) ? a.distance_km : Number.POSITIVE_INFINITY
        const distanceB = Number.isFinite(b.distance_km) ? b.distance_km : Number.POSITIVE_INFINITY
        return distanceA - distanceB
      })
    }

    return NextResponse.json({
      results,
      count: results.length,
      query,
      filters: {
        location,
        category,
        inStockOnly,
        hasLocation: hasUserCoordinates,
      },
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
