import { format } from 'date-fns'
import type { EnrichedInventoryRow, EnrichedBatch } from '@/lib/pharmacyInventory'

export const STOCK_COLORS = {
  in: { color: '#639922', bg: '#F2F7EA' },
  low: { color: '#BA7517', bg: '#FBF2E6' },
  out: { color: '#E24B4A', bg: '#FBEDEC' },
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
    return { label: 'Expired', color: '#E24B4A', bg: '#FFFFFF', outline: true }
  }
  if (row.is_expiring_soon) {
    return { label: 'Expiring soon', color: '#BA7517', bg: '#FFFFFF', outline: true }
  }
  const stock = STOCK_COLORS[row.stock_status]
  const label =
    row.stock_status === 'in' ? 'In stock' : row.stock_status === 'low' ? 'Low stock' : 'Out of stock'
  return { label, color: stock.color, bg: stock.bg, outline: false }
}

export function getBatchBadge(batch: Pick<EnrichedBatch, 'is_expired' | 'is_expiring_soon'>) {
  if (batch.is_expired) return { label: 'Expired', color: '#E24B4A' }
  if (batch.is_expiring_soon) return { label: 'Expiring soon', color: '#BA7517' }
  return { label: 'OK', color: '#639922' }
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
