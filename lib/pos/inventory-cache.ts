import type { LocalInventoryItem, LocalSale } from '@/lib/db/pos-local-db'

/** Reapply device-only sales to a fresh authoritative inventory snapshot. */
export function applyPendingSaleDeductions(
  inventory: LocalInventoryItem[],
  sales: LocalSale[],
): LocalInventoryItem[] {
  const itemDeductions = new Map<string, number>()
  const batchDeductions = new Map<string, number>()

  for (const sale of sales) {
    if (!['pending', 'error'].includes(sale.sync_status)) continue
    for (const item of sale.items) {
      if (item.deducts_local_stock === false) continue
      itemDeductions.set(
        item.inventory_id,
        (itemDeductions.get(item.inventory_id) ?? 0) + item.quantity,
      )
      if (item.batch_id) {
        batchDeductions.set(
          item.batch_id,
          (batchDeductions.get(item.batch_id) ?? 0) + item.quantity,
        )
      }
    }
  }

  return inventory.map(item => ({
    ...item,
    quantity_in_stock: Math.max(
      0,
      item.quantity_in_stock - (itemDeductions.get(item.id) ?? 0),
    ),
    batches: item.batches.map(batch => ({
      ...batch,
      remaining_qty: Math.max(
        0,
        batch.remaining_qty - (batchDeductions.get(batch.id) ?? 0),
      ),
    })),
  }))
}
