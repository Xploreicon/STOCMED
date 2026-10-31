import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const fixtures = vi.hoisted(() => ({
  rpc: vi.fn(), queries: [] as { table: string; ranges: number[][]; filters: string[]; selection: string }[],
  failure: false,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  rpc: fixtures.rpc,
  from: (table: string) => {
    const query = { table, ranges: [] as number[][], filters: [] as string[], selection: '' }
    fixtures.queries.push(query)
    const builder = {
      select: (selection: string) => { query.selection = selection; return builder },
      eq: () => builder, order: () => builder, in: () => builder,
      range: (...range: number[]) => { query.ranges.push(range); return builder },
      or: (filter: string) => { query.filters.push(filter); return builder },
      then: (resolve: (value: unknown) => void) => resolve({
        error: fixtures.failure ? { message: 'Database unavailable' } : null,
        data: table === 'purchase_orders' ? [{ id: 'order', purchase_order_items: [{ id: 'line', product_id: 'medicine-0', products: { generic_name: 'Medicine' } }], goods_receipts: [{ reversed_at: null, goods_receipt_items: [{ line_total: 300 }] }, { reversed_at: '2026-10-31', goods_receipt_items: [{ line_total: 100 }] }] }] : query.selection.startsWith('product_id,') ? [{ product_id: 'medicine-0', price: 300, deleted_at: '2026-10-01', recovery_expires_at: '2026-12-01', base_unit_name: 'tablet' }]
          : Array.from({ length: 26 }, (_, index) => ({ id: `${table === 'products' ? 'medicine' : 'store'}-${index}`, generic_name: 'Medicine', item_name: 'Store item' })),
      }),
    }
    return builder
  },
}) }))
vi.mock('@/lib/pharmacy', () => ({ ensurePharmacyRecord: async () => ({ id: 'tenant' }) }))
vi.mock('@/lib/pharmacy-features', () => ({ requirePharmacyFeature: async () => null }))
import { GET, POST } from '@/app/api/pharmacy/procurement/route'

beforeEach(() => { fixtures.rpc.mockReset(); fixtures.queries.length = 0; fixtures.failure = false })

describe('procurement API contract', () => {
  it('searches and pages both catalogues and exposes recovery/pricing details', async () => {
    const response = await GET(new NextRequest('https://example.test/api/pharmacy/procurement?view=products&q=amoxicillin&page=4'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.products).toHaveLength(50)
    expect(body.has_more).toBe(true)
    expect(body.products[0]).toMatchObject({ is_new: false, selling_price: 300, deleted_at: '2026-10-01', base_unit_name: 'tablet' })
    expect(fixtures.queries[0].ranges).toEqual([[100,125]])
    expect(fixtures.queries[1].ranges).toEqual([[100,125]])
    expect(fixtures.queries[0].filters[0]).toContain('amoxicillin')
  })
  it('shows the actual inventory base unit and excludes reversed receipt costs from order totals', async () => {
    const response = await GET(new NextRequest('https://example.test/api/pharmacy/procurement?view=orders'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.orders[0].received_total).toBe(300)
    expect(body.orders[0].purchase_order_items[0].products).toMatchObject({ base_unit_name: 'tablet', is_new: false, selling_price: 300 })
  })
  it('returns a load failure rather than pretending inventory is empty', async () => {
    fixtures.failure = true
    const response = await GET(new NextRequest('https://example.test/api/pharmacy/procurement?view=products'))
    expect(response.status).toBe(500)
  })
  it('binds writes to the authenticated tenant and staff header', async () => {
    fixtures.rpc.mockResolvedValue({ data: { success: false, code: 'STAFF_PERMISSION_DENIED', error: 'Not permitted' }, error: null })
    const response = await POST(new NextRequest('https://example.test/api/pharmacy/procurement', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-staff-session': 'verified-session' },
      body: JSON.stringify({ action: 'receive', request_key: 'delivery-key', authorization: { restore_inventory: 'restore-token' }, pharmacy_id: 'forged-tenant' }),
    }))
    expect(response.status).toBe(403)
    expect(fixtures.rpc).toHaveBeenCalledWith('write_procurement', expect.objectContaining({
      p_pharmacy_id: 'tenant', p_staff_token: 'verified-session',
      p_sp_tokens: { restore_inventory: 'restore-token', price_change: null, stock_adjustment: null },
    }))
    expect(fixtures.rpc.mock.calls[0][1].p_command).not.toHaveProperty('authorization')
  })
  it('returns the particular SP action needed for an atomic restore-and-receive retry', async () => {
    fixtures.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', hint: 'restore_inventory', message: 'Superintendent authorization is required' } })
    const response = await POST(new NextRequest('https://example.test/api/pharmacy/procurement', { method: 'POST', body: JSON.stringify({ action: 'receive' }) }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'SP_AUTH_REQUIRED', action: 'restore_inventory' })
  })
})
