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
  product_id: string
  name: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  category: string | null
  dosage_form: string | null
  strength: string
  pack_size: string | null
  requires_prescription: boolean
  image_url: string | null
  price: number
  quantity_in_stock: number
  low_stock_threshold: number
  notes: string | null
  is_listed: boolean
  created_at: string
  updated_at: string
  stock_status: 'in' | 'low' | 'out'
  expiry_date: string | null
  is_expired: boolean
  is_expiring_soon: boolean
  batches: EnrichedBatch[]
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

/**
 * Fetches this pharmacy's inventory joined with product catalogue data and
 * batches, and decorates each row with stock/expiry status derived from the
 * stock_movements ledger (batch quantities are derived, not stored).
 */
export async function getEnrichedInventory(
  supabase: SupabaseServerClient,
  pharmacyId: string
): Promise<{ rows: EnrichedInventoryRow[]; stats: InventoryStats }> {
  const { data: inventoryRows, error: invError } = await supabase
    .from('pharmacy_inventory')
    .select('*, products(*), batches(*)')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })

  if (invError) throw invError

  const inventoryIds = (inventoryRows ?? []).map((r: any) => r.id)
  const batchIds = (inventoryRows ?? []).flatMap((r: any) => (r.batches ?? []).map((b: any) => b.id))

  let movementsByBatch = new Map<string, number>()
  if (inventoryIds.length > 0) {
    const { data: movements, error: movError } = await supabase
      .from('stock_movements')
      .select('batch_id, quantity')
      .in('inventory_id', inventoryIds)

    if (movError) throw movError

    for (const m of movements ?? []) {
      const key = (m as any).batch_id
      if (!key) continue
      movementsByBatch.set(key, (movementsByBatch.get(key) ?? 0) + (m as any).quantity)
    }
  }
  void batchIds

  const rows: EnrichedInventoryRow[] = (inventoryRows ?? []).map((inv: any) => {
    const product = inv.products
    const batches: EnrichedBatch[] = (inv.batches ?? [])
      .map((b: any) => {
        const remaining = movementsByBatch.get(b.id) ?? b.quantity_received
        const days = daysFromNow(b.expiry_date)
        return {
          id: b.id,
          batch_number: b.batch_number,
          expiry_date: b.expiry_date,
          quantity_received: b.quantity_received,
          cost_price: b.cost_price,
          remaining_qty: remaining,
          is_expired: days < 0,
          is_expiring_soon: days >= 0 && days <= EXPIRING_SOON_DAYS,
        }
      })
      .sort((a: EnrichedBatch, b: EnrichedBatch) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())

    const earliestActiveBatch = batches.find((b) => b.remaining_qty > 0) ?? batches[0] ?? null

    const qty = inv.quantity_in_stock
    const threshold = inv.low_stock_threshold
    const stockStatus: 'in' | 'low' | 'out' = qty <= 0 ? 'out' : qty <= threshold ? 'low' : 'in'

    return {
      id: inv.id,
      pharmacy_id: inv.pharmacy_id,
      product_id: inv.product_id,
      name: product?.brand_name || product?.generic_name || 'Unknown product',
      generic_name: product?.generic_name ?? '',
      brand_name: product?.brand_name ?? null,
      manufacturer: product?.manufacturer ?? null,
      category: product?.category ?? null,
      dosage_form: product?.dosage_form ?? null,
      strength: product?.strength ?? '',
      pack_size: product?.pack_size ?? null,
      requires_prescription: product?.requires_prescription ?? false,
      image_url: product?.image_url ?? null,
      price: inv.price,
      quantity_in_stock: qty,
      low_stock_threshold: threshold,
      notes: inv.notes ?? null,
      is_listed: inv.is_listed,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      stock_status: stockStatus,
      expiry_date: earliestActiveBatch?.expiry_date ?? null,
      is_expired: earliestActiveBatch?.is_expired ?? false,
      is_expiring_soon: earliestActiveBatch?.is_expiring_soon ?? false,
      batches,
    }
  })

  const stats: InventoryStats = {
    total: rows.length,
    in_stock: rows.filter((r) => r.stock_status === 'in').length,
    low_stock: rows.filter((r) => r.stock_status === 'low').length,
    out_of_stock: rows.filter((r) => r.stock_status === 'out').length,
    expiring_soon: rows.filter((r) => r.is_expiring_soon && !r.is_expired).length,
  }

  return { rows, stats }
}
