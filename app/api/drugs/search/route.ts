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

    // Build the query
    let queryBuilder = supabase
      .from('drugs')
      .select(`
        *,
        pharmacies:pharmacy_id (
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
        )
      `)
      .order('updated_at', { ascending: false })
      .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_name.ilike.%${query}%`)
      .eq('pharmacies.is_active', true)

    // Apply filters
    if (category) {
      queryBuilder = queryBuilder.eq('category', category)
    }

    if (inStockOnly) {
      queryBuilder = queryBuilder.gt('quantity_in_stock', 0)
    }

    // Execute query
    const { data: drugs, error } = await queryBuilder

    if (error) {
      console.error('Search error:', error)
      return NextResponse.json(
        { error: 'Failed to search drugs' },
        { status: 500 }
      )
    }

    // Filter by pharmacy location if provided
    let results = (drugs || []).map((drug: any) => {
      const price = typeof drug.price === 'number' ? drug.price : Number(drug.price)
      const priceDelta = Number.isFinite(price) ? price * 0.05 : null
      const pharmacy = drug.pharmacies
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

      return {
        ...drug,
        price_range_min: Number.isFinite(price) ? Math.max(Math.round((price - (priceDelta ?? 0)) / 10) * 10, 0) : null,
        price_range_max: Number.isFinite(price) ? Math.round((price + (priceDelta ?? 0)) / 10) * 10 : null,
        distance_km: distanceKm,
      }
    })

    if (location) {
      results = results.filter((drug: any) => {
        const pharmacy = drug.pharmacies
        return pharmacy && (
          pharmacy.city?.toLowerCase().includes(location.toLowerCase()) ||
          pharmacy.state?.toLowerCase().includes(location.toLowerCase())
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
