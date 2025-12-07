import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    const location = searchParams.get('location')
    const category = searchParams.get('category')
    const inStockOnly = searchParams.get('in_stock_only') === 'true'

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
          longitude
        )
      `)
      .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_name.ilike.%${query}%`)

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
    let results = drugs || []
    if (location) {
      results = results.filter((drug: any) => {
        const pharmacy = drug.pharmacies
        return pharmacy && (
          pharmacy.city?.toLowerCase().includes(location.toLowerCase()) ||
          pharmacy.state?.toLowerCase().includes(location.toLowerCase())
        )
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
