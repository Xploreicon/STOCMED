import { describe, expect, it, vi } from 'vitest'
import { assembleEnrichedInventory, getEnrichedInventory } from '@/lib/pharmacyInventory'

const inventory = {
  id: 'inventory-1',
  pharmacy_id: 'pharmacy-1',
  product_id: 'product-1',
  item_type: 'medicine',
  tracks_expiry: true,
  batch_capture_required: false,
  item_name: null,
  unit_description: null,
  store_category: null,
  unit_cost: 120,
  brand: null,
  barcode: null,
  image_url: 'pharmacy-image.png',
  price: 500,
  quantity_in_stock: 10,
  low_stock_threshold: 5,
  notes: 'Shelf A',
  is_listed: true,
  deleted_at: null,
  created_at: '2026-09-05T10:00:00.000Z',
  updated_at: '2026-09-05T10:00:00.000Z',
  base_unit_name: 'tablet',
  whole_pack_only: false,
}

const product = {
  id: 'product-1',
  generic_name: 'Ofloxacin',
  brand_name: 'Tarivid 200 mg Tablet',
  manufacturer: 'Sanofi Winthrop Industrie',
  nafdac_number: 'A1-0000',
  barcode: null,
  category: 'Antibiotics',
  dosage_form: 'tablet',
  strength: '200 mg',
  pack_size: '10 tablets',
  requires_prescription: true,
  image_url: 'catalogue-image.png',
}

const snapshot = [{
  inventory,
  product,
  reserved_quantity: 3,
  sellable_quantity: 7,
  batches: [
    {
      id: 'batch-expired',
      inventory_id: 'inventory-1',
      batch_number: 'OLD',
      expiry_date: '2000-01-01',
      quantity_received: 2,
      cost_price: 100,
      __ledger_remaining: 0,
      __reserved_quantity: 0,
    },
    {
      id: 'batch-active',
      inventory_id: 'inventory-1',
      batch_number: 'LIVE',
      expiry_date: '2099-01-01',
      quantity_received: 10,
      cost_price: 110,
      __ledger_remaining: 10,
      __reserved_quantity: 3,
    },
  ],
  selling_units: [{
    id: 'unit-1',
    inventory_id: 'inventory-1',
    unit_name: 'card',
    units_per: '10',
    price: '5000.00',
    barcode: null,
    is_default: true,
    sort_order: 1,
    created_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
  }],
}]

describe('set-based pharmacy inventory read', () => {
  it('uses exactly one inventory RPC and preserves the endpoint payload contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null })

    const result = await getEnrichedInventory({ rpc } as any, 'pharmacy-1')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_pharmacy_inventory_enriched', {
      p_pharmacy_id: 'pharmacy-1',
      p_show_delisted: false,
    })
    expect(Object.keys(result.rows[0]).sort()).toEqual([
      'barcode',
      'base_unit_name',
      'batch_capture_required',
      'batches',
      'brand_name',
      'category',
      'created_at',
      'deleted_at',
      'display_image_url',
      'dosage_form',
      'expiry_date',
      'generic_name',
      'id',
      'image_url',
      'is_expired',
      'is_expiring_soon',
      'is_listed',
      'item_name',
      'item_type',
      'low_stock_threshold',
      'manufacturer',
      'nafdac_number',
      'name',
      'notes',
      'pack_size',
      'pharmacy_id',
      'pharmacy_image_url',
      'price',
      'product_id',
      'quantity_in_stock',
      'requires_prescription',
      'reserved_quantity',
      'sellable_quantity',
      'selling_units',
      'stock_status',
      'store_category',
      'strength',
      'tracks_expiry',
      'unit_cost',
      'unit_description',
      'updated_at',
      'whole_pack_only',
    ])
    expect(result.rows[0]).toMatchObject({
      id: 'inventory-1',
      name: 'Tarivid 200 mg Tablet',
      generic_name: 'Ofloxacin',
      strength: '200 mg',
      dosage_form: 'tablet',
      quantity_in_stock: 10,
      reserved_quantity: 3,
      sellable_quantity: 7,
      stock_status: 'in',
      expiry_date: '2099-01-01',
      image_url: 'catalogue-image.png',
      pharmacy_image_url: 'pharmacy-image.png',
      display_image_url: 'pharmacy-image.png',
    })
    expect(result.rows[0].batches).toEqual([{
      id: 'batch-active',
      batch_number: 'LIVE',
      expiry_date: '2099-01-01',
      quantity_received: 10,
      cost_price: 110,
      remaining_qty: 7,
      is_expired: false,
      is_expiring_soon: false,
    }])
    expect(result.rows[0].selling_units[0]).toMatchObject({
      id: 'unit-1',
      inventory_id: 'inventory-1',
      units_per: 10,
      price: 5000,
    })
    expect(result.stats).toEqual({
      total: 1,
      in_stock: 1,
      low_stock: 0,
      out_of_stock: 0,
      expiring_soon: 0,
    })
  })

  it('propagates the RPC failure instead of returning a partial inventory', async () => {
    const failure = { code: '42501', message: 'permission denied' }
    const rpc = vi.fn().mockResolvedValue({ data: null, error: failure })

    await expect(getEnrichedInventory({ rpc } as any, 'other-pharmacy', { showDelisted: true }))
      .rejects.toBe(failure)
    expect(rpc).toHaveBeenCalledWith('get_pharmacy_inventory_enriched', {
      p_pharmacy_id: 'other-pharmacy',
      p_show_delisted: true,
    })
  })

  it('assembles an empty snapshot into the unchanged empty payload', () => {
    expect(assembleEnrichedInventory([])).toEqual({
      rows: [],
      stats: { total: 0, in_stock: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0 },
    })
  })
})
