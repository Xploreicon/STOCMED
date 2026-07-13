/**
 * FEFO (First-Expired-First-Out) batch selection engine.
 * This is the "quiet QuickBooks killer" — the cashier never chooses a batch.
 * The system silently picks the earliest-expiring batch with stock, and splits
 * across batches if the requested quantity exceeds a single batch.
 */

import type { LocalBatch } from '@/lib/db/pos-local-db'

export interface FEFOAllocation {
  batch_id: string
  batch_number: string
  expiry_date: string
  quantity: number
}

export type FEFOResult = {
  success: true
  allocations: FEFOAllocation[]
} | {
  success: false
  error: string
  errorType: 'EXPIRED' | 'NO_STOCK' | 'INSUFFICIENT'
}

/**
 * Allocate `requestedQty` units across batches using FEFO ordering.
 * - Batches are sorted by expiry_date ASC (earliest first).
 * - Expired batches are BLOCKED (never silently sold).
 * - If earliest batch has less than requested, splits across multiple batches.
 */
export function allocateFEFO(
  batches: LocalBatch[],
  requestedQty: number
): FEFOResult {
  // Sort by expiry date ascending (earliest first)
  const sorted = [...batches]
    .filter(b => b.remaining_qty > 0)
    .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())

  if (sorted.length === 0) {
    return { success: false, error: 'No batches with available stock.', errorType: 'NO_STOCK' }
  }

  // Check if the earliest batch is expired — BLOCK the sale
  const earliest = sorted[0]
  if (earliest.is_expired) {
    return {
      success: false,
      error: `Batch ${earliest.batch_number} (Exp: ${formatExpShort(earliest.expiry_date)}) is EXPIRED. Cannot sell expired stock.`,
      errorType: 'EXPIRED',
    }
  }

  // Check total available across all non-expired batches
  const nonExpired = sorted.filter(b => !b.is_expired)
  const totalAvailable = nonExpired.reduce((sum, b) => sum + b.remaining_qty, 0)

  if (totalAvailable < requestedQty) {
    return {
      success: false,
      error: `Only ${totalAvailable} units available (requested ${requestedQty}).`,
      errorType: 'INSUFFICIENT',
    }
  }

  // Allocate across batches (oldest first)
  const allocations: FEFOAllocation[] = []
  let remaining = requestedQty

  for (const batch of nonExpired) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.remaining_qty)
    allocations.push({
      batch_id: batch.id,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      quantity: take,
    })
    remaining -= take
  }

  return { success: true, allocations }
}

/** Short month+year format for expiry display */
export function formatExpShort(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}
