import { format } from 'date-fns'
import type { EnrichedInventoryRow, EnrichedBatch } from '@/lib/pharmacyInventory'

export const STOCK_COLORS = {
  in: { color: 'var(--success)', bg: 'var(--success-tint)' },
  low: { color: 'var(--warning)', bg: 'var(--warning-tint)' },
  out: { color: 'var(--danger)', bg: 'var(--danger-tint)' },
} as const

export function formatNaira(amount: number) {
  return '₦' + Math.round(amount).toLocaleString()
}

export function formatExpiry(dateStr: string | null) {
  if (!dateStr) return '—'
  try {
    return format(new Date(dateStr), 'MMM yyyy')
  } catch {
    return dateStr
  }
}

export interface RowBadge {
  label: string
  color: string
  bg: string
  outline: boolean
}

export function getRowBadge(row: Pick<EnrichedInventoryRow, 'stock_status' | 'is_expired' | 'is_expiring_soon'>): RowBadge {
  if (row.is_expired) {
    return { label: 'Expired', color: 'var(--danger)', bg: 'var(--white)', outline: true }
  }
  if (row.is_expiring_soon) {
    return { label: 'Expiring soon', color: 'var(--warning)', bg: 'var(--white)', outline: true }
  }
  const stock = STOCK_COLORS[row.stock_status]
  const label =
    row.stock_status === 'in' ? 'In stock' : row.stock_status === 'low' ? 'Low stock' : 'Out of stock'
  return { label, color: stock.color, bg: stock.bg, outline: false }
}

export function getBatchBadge(batch: Pick<EnrichedBatch, 'is_expired' | 'is_expiring_soon'>) {
  if (batch.is_expired) return { label: 'Expired', color: 'var(--danger)' }
  if (batch.is_expiring_soon) return { label: 'Expiring soon', color: 'var(--warning)' }
  return { label: 'OK', color: 'var(--success)' }
}

export const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In stock' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
  { key: 'expiringSoon', label: 'Expiring soon' },
  { key: 'expired', label: 'Expired' },
] as const

export type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key']

export function matchesFilter(row: EnrichedInventoryRow, filter: StatusFilterKey) {
  switch (filter) {
    case 'all':
      return true
    case 'expired':
      return row.is_expired
    case 'expiringSoon':
      return row.is_expiring_soon && !row.is_expired
    default:
      return row.stock_status === filter
  }
}
