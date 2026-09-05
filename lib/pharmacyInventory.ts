import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type SupabaseServerClient = SupabaseClient<Database, 'public', any>

export const EXPIRING_SOON_DAYS = 60

export type MovementUiType = 'Restock' | 'Adjustment' | 'Return' | 'Write-off' | 'Expiry' | 'Sale'

export const MOVEMENT_TYPE_MAP: Record<
  MovementUiType,
  { db: Database['public']['Enums']['stock_movement_type']; sign: 'positive' | 'negative' | 'signed' }
> = {
  Restock: { db: 'restock', sign: 'positive' },
  Adjustment: { db: 'adjustment', sign: 'signed' },
  Return: { db: 'return', sign: 'positive' },
  'Write-off': { db: 'write_off', sign: 'negative' },
  Expiry: { db: 'expiry_writeoff', sign: 'negative' },
  // Not offered in the Adjust Stock UI directly — used internally by the POS modal.
  Sale: { db: 'sale', sign: 'negative' },
}

export interface EnrichedBatch {
  id: string
  batch_number: string
  expiry_date: string
  quantity_received: number
  cost_price: number | null
  remaining_qty: number
  is_expired: boolean
  is_expiring_soon: boolean
}

export interface EnrichedInventoryRow {
  id: string
  pharmacy_id: string
  product_id: string | null
  item_type: 'medicine' | 'store'
  tracks_expiry: boolean
  batch_capture_required: boolean
  item_name: string | null
  unit_description: string | null
  store_category: string | null
  unit_cost: number | null
  name: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  nafdac_number: string | null
  barcode: string | null
  category: string | null
  dosage_form: string | null
  strength: string
  pack_size: string | null
  requires_prescription: boolean
  /** Catalogue-level image from products table (shared across pharmacies) */
  image_url: string | null
  /** Pharmacy-level image override from pharmacy_inventory table */
  pharmacy_image_url: string | null
  /** Resolved display image: pharmacy override → catalogue image → null */
  display_image_url: string | null
  price: number
  quantity_in_stock: number
  reserved_quantity: number
  sellable_quantity: number
  low_stock_threshold: number
  notes: string | null
  is_listed: boolean
  /** Non-null when the item has been soft-deleted (delisted) */
  deleted_at: string | null
  created_at: string
  updated_at: string
  stock_status: 'in' | 'low' | 'out'
  expiry_date: string | null
  is_expired: boolean
  is_expiring_soon: boolean
  batches: EnrichedBatch[]
  selling_units: Array<{
    id: string
    unit_name: string
    units_per: number
    price: number
    barcode: string | null
    is_default: boolean
    sort_order: number
  }>
  base_unit_name: string
  whole_pack_only: boolean
}

export interface InventoryStats {
  total: number
  in_stock: number
  low_stock: number
  out_of_stock: number
  expiring_soon: number
}

function daysFromNow(dateStr: string): number {
  const ms = new Date(dateStr).getTime() - Date.now()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

interface InventorySnapshotRow {
  inventory: Record<string, any>
  product: Record<string, any> | null
  batches: Array<Record<string, any>> | null
  selling_units: Array<Record<string, any>> | null
  reserved_quantity: number
  sellable_quantity: number
}

export function assembleEnrichedInventory(
  snapshot: InventorySnapshotRow[],
): { rows: EnrichedInventoryRow[]; stats: InventoryStats } {
  const rows: EnrichedInventoryRow[] = snapshot.map((entry) => {
    const inv = entry.inventory
    const product = entry.product
    const batches: EnrichedBatch[] = (entry.batches ?? [])
      .map((batch: any) => {
        const ledgerRemaining = Number(batch.__ledger_remaining ?? batch.quantity_received)
        const remaining = Math.max(0, ledgerRemaining - Number(batch.__reserved_quantity ?? 0))
        const days = daysFromNow(batch.expiry_date)
        return {
          id: batch.id,
          batch_number: batch.batch_number,
          expiry_date: batch.expiry_date,
          quantity_received: batch.quantity_received,
          cost_price: batch.cost_price,
          remaining_qty: remaining,
          is_expired: days < 0,
          is_expiring_soon: days >= 0 && days <= EXPIRING_SOON_DAYS,
        }
      })
      .filter((batch: EnrichedBatch) => batch.remaining_qty > 0)
      .sort((a: EnrichedBatch, b: EnrichedBatch) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())

    const earliestActiveBatch = batches.find((batch) => batch.remaining_qty > 0) ?? batches[0] ?? null
    const qty = Number(inv.quantity_in_stock)
    const sellableQty = Number(entry.sellable_quantity)
    const threshold = Number(inv.low_stock_threshold)
    const stockStatus: 'in' | 'low' | 'out' = sellableQty <= 0 ? 'out' : sellableQty <= threshold ? 'low' : 'in'
    const catalogueImage = product?.image_url ?? null
    const pharmacyImage = inv.image_url ?? null
    const displayImage = pharmacyImage || catalogueImage || null

    return {
      id: inv.id,
      pharmacy_id: inv.pharmacy_id,
      product_id: inv.product_id,
      item_type: inv.item_type ?? 'medicine',
      tracks_expiry: inv.tracks_expiry ?? true,
      batch_capture_required: inv.batch_capture_required ?? false,
      item_name: inv.item_name ?? null,
      unit_description: inv.unit_description ?? null,
      store_category: inv.store_category ?? null,
      unit_cost: inv.unit_cost ?? null,
      name: product?.brand_name || product?.generic_name || inv.item_name || 'Unknown item',
      generic_name: product?.generic_name ?? inv.item_name ?? '',
      brand_name: product?.brand_name ?? inv.brand ?? null,
      manufacturer: product?.manufacturer ?? null,
      nafdac_number: product?.nafdac_number ?? null,
      barcode: product?.barcode ?? inv.barcode ?? null,
      category: product?.category ?? inv.store_category ?? null,
      dosage_form: product?.dosage_form ?? null,
      strength: product?.strength ?? inv.unit_description ?? '',
      pack_size: product?.pack_size ?? inv.unit_description ?? null,
      requires_prescription: product?.requires_prescription ?? false,
      image_url: catalogueImage,
      pharmacy_image_url: pharmacyImage,
      display_image_url: displayImage,
      price: inv.price,
      quantity_in_stock: qty,
      reserved_quantity: Number(entry.reserved_quantity),
      sellable_quantity: sellableQty,
      low_stock_threshold: threshold,
      notes: inv.notes ?? null,
      is_listed: inv.is_listed,
      deleted_at: inv.deleted_at ?? null,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      stock_status: stockStatus,
      expiry_date: earliestActiveBatch?.expiry_date ?? null,
      is_expired: earliestActiveBatch?.is_expired ?? false,
      is_expiring_soon: earliestActiveBatch?.is_expiring_soon ?? false,
      batches,
      selling_units: (entry.selling_units ?? [])
        .map((unit: any) => ({ ...unit, price: Number(unit.price), units_per: Number(unit.units_per) }))
        .sort((a: any, b: any) => a.sort_order - b.sort_order),
      base_unit_name: inv.base_unit_name ?? 'unit',
      whole_pack_only: inv.whole_pack_only ?? false,
    }
  })

  return {
    rows,
    stats: {
      total: rows.length,
      in_stock: rows.filter((row) => row.stock_status === 'in').length,
      low_stock: rows.filter((row) => row.stock_status === 'low').length,
      out_of_stock: rows.filter((row) => row.stock_status === 'out').length,
      expiring_soon: rows.filter((row) => row.is_expiring_soon && !row.is_expired).length,
    },
  }
}

/**
 * Fetches this pharmacy's inventory joined with product catalogue data and
 * batches, and decorates each row with stock/expiry status derived from the
 * stock_movements ledger (batch quantities are derived, not stored).
 */
export async function getEnrichedInventory(
  supabase: SupabaseServerClient,
  pharmacyId: string,
  options: { showDelisted?: boolean } = {}
): Promise<{ rows: EnrichedInventoryRow[]; stats: InventoryStats }> {
  const { data, error } = await (supabase.rpc as any)('get_pharmacy_inventory_enriched', {
    p_pharmacy_id: pharmacyId,
    p_show_delisted: options.showDelisted === true,
  })
  if (error) throw error

  return assembleEnrichedInventory((data ?? []) as InventorySnapshotRow[])
}
