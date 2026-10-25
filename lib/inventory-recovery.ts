export const INVENTORY_RECOVERY_DAYS = 60
export const MAX_BULK_INVENTORY_ITEMS = 500

export type RecoverableInventoryItem = {
  deleted_at?: string | null
  recovery_expires_at?: string | null
}

export function inventoryRecoveryDeadline(item: RecoverableInventoryItem): string | null {
  if (!item.deleted_at) return null
  const removedAt = Date.parse(item.deleted_at)
  if (!Number.isFinite(removedAt)) return null
  const expiry = item.recovery_expires_at ??
    new Date(removedAt + INVENTORY_RECOVERY_DAYS * 86400000).toISOString()
  return Number.isFinite(Date.parse(expiry)) ? expiry : null
}

export function canRestoreInventory(item: RecoverableInventoryItem, now = Date.now()): boolean {
  const expiry = inventoryRecoveryDeadline(item)
  return expiry !== null && Date.parse(expiry) > now
}
