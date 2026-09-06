import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const query = request.nextUrl.searchParams.get('q')?.trim() || ''
  if (query.length < 2) return NextResponse.json({ products: [] })

  const { data, error } = await (access.supabase.rpc as any)(
    'search_catalogue_products_for_review',
    { p_query: query, p_limit: 12 },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ products: Array.isArray(data) ? data : [] }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
