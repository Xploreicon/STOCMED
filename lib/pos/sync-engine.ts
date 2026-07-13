/** Offline POS and shift sync with exponential backoff. */

import { posLocalDb, type LocalSale, type LocalShift } from '@/lib/db/pos-local-db'

const BASE_DELAY_MS = 5_000
const MAX_DELAY_MS = 300_000

function getBackoffDelay(retryCount: number): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** retryCount, MAX_DELAY_MS)
  return delay * (0.8 + Math.random() * 0.4)
}

function isReadyForRetry(record: LocalSale | LocalShift, now: string) {
  return !record.next_retry_at || record.next_retry_at <= now
}

export interface SyncResult {
  synced: number
  failed: number
  pending: number
  status: 'synced' | 'pending' | 'error' | 'syncing'
}

async function pendingCount() {
  if (!posLocalDb) return 0
  const [sales, shifts] = await Promise.all([
    posLocalDb.local_sales.where('sync_status').anyOf(['pending', 'error']).count(),
    posLocalDb.local_shifts.where('sync_status').equals('pending').count(),
  ])
  return sales + shifts
}

export function retryPatch(record: LocalSale | LocalShift, error: string) {
  const retryCount = record.retry_count + 1
  return {
    sync_status: 'pending' as const,
    sync_error: error,
    retry_count: retryCount,
    next_retry_at: new Date(Date.now() + getBackoffDelay(retryCount)).toISOString(),
  }
}

export async function syncPendingSales(
  onProgress?: (result: SyncResult) => void
): Promise<SyncResult> {
  if (!posLocalDb || !navigator.onLine) {
    const pending = await pendingCount()
    return { synced: 0, failed: 0, pending, status: pending ? 'pending' : 'synced' }
  }
  const db = posLocalDb

  const now = new Date().toISOString()
  const [eligibleSales, eligibleShifts] = await Promise.all([
    db.local_sales
      .where('sync_status')
      .anyOf(['pending', 'error'])
      .filter((sale) => isReadyForRetry(sale, now))
      .toArray(),
    db.local_shifts
      .where('sync_status')
      .equals('pending')
      .filter((shift) => isReadyForRetry(shift, now))
      .toArray(),
  ])

  if (!eligibleSales.length && !eligibleShifts.length) {
    const pending = await pendingCount()
    return { synced: 0, failed: 0, pending, status: pending ? 'pending' : 'synced' }
  }

  let synced = 0
  let failed = 0

  try {
    const response = await fetch('/api/pharmacy/pos/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shifts: eligibleShifts, sales: eligibleSales }),
    })
    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Sync request failed')
    }

    for (const id of result.syncedIds ?? []) {
      await db.local_sales.update(id, {
        sync_status: 'synced', sync_error: undefined, retry_count: 0, next_retry_at: undefined,
      })
      synced++
    }
    for (const id of result.syncedShiftIds ?? []) {
      await db.local_shifts.update(id, {
        sync_status: 'synced', sync_error: undefined, retry_count: 0, next_retry_at: undefined,
      })
      synced++
    }
    for (const failure of result.failedIds ?? []) {
      const sale = eligibleSales.find((item) => item.id === failure.id)
      if (sale) await db.local_sales.update(failure.id, retryPatch(sale, failure.error))
      failed++
    }
    for (const failure of result.failedShiftIds ?? []) {
      const shift = eligibleShifts.find((item) => item.id === failure.id)
      if (shift) await db.local_shifts.update(failure.id, retryPatch(shift, failure.error))
      failed++
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    await Promise.all([
      ...eligibleSales.map((sale) => db.local_sales.update(sale.id, retryPatch(sale, message))),
      ...eligibleShifts.map((shift) => db.local_shifts.update(shift.id, retryPatch(shift, message))),
    ])
    failed = eligibleSales.length + eligibleShifts.length
  }

  const pending = await pendingCount()
  const result: SyncResult = {
    synced,
    failed,
    pending,
    status: pending ? (failed ? 'error' : 'pending') : 'synced',
  }
  onProgress?.(result)
  return result
}

/** Manual retry resets backoff; automatic retries remain enabled indefinitely. */
export async function forceRetryAll(): Promise<void> {
  if (!posLocalDb) return
  const db = posLocalDb
  const [sales, shifts] = await Promise.all([
    db.local_sales.where('sync_status').anyOf(['pending', 'error']).toArray(),
    db.local_shifts.where('sync_status').equals('pending').toArray(),
  ])
  await Promise.all([
    ...sales.map((sale) => db.local_sales.update(sale.id, {
      sync_status: 'pending', retry_count: 0, next_retry_at: undefined,
    })),
    ...shifts.map((shift) => db.local_shifts.update(shift.id, {
      sync_status: 'pending', retry_count: 0, next_retry_at: undefined,
    })),
  ])
}
