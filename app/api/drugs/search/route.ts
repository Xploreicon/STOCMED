import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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
      .eq('is_listed', true)
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
    const { data: inventory, error } = await queryBuilder

    if (error) {
      console.error('Search error:', error)
      return NextResponse.json(
        { error: 'Failed to search drugs' },
        { status: 500 }
      )
    }

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

      return {
        id: row.id,
        pharmacy_id: pharmacy?.id || null,
        name: product?.brand_name || product?.generic_name || '',
        generic_name: product?.generic_name || null,
        brand_name: product?.brand_name || null,
        category: product?.category || '',
        dosage_form: product?.dosage_form || '',
        strength: product?.strength || null,
        description: product?.description || null,
        price: price,
        quantity_in_stock: row.quantity_in_stock,
        low_stock_threshold: row.low_stock_threshold,
        requires_prescription: product?.requires_prescription || false,
        manufacturer: product?.manufacturer || null,
        expiry_date: expiryDate,
        created_at: row.created_at,
        updated_at: row.updated_at,
        image_url: product?.image_url || null,
        pharmacies: pharmacy || null,
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
