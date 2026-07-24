import { z } from 'zod'

const uuid = z.string().uuid()
const money = z.coerce.number().finite().nonnegative()

export const localShiftSchema = z.object({
  id: uuid,
  pharmacy_id: uuid,
  cashier_id: uuid,
  opened_at: z.string().datetime(),
  opening_float: money,
  closed_at: z.string().datetime().optional(),
  counted_cash: money.optional(),
  expected_cash: z.number().finite().optional(),
  variance: z.number().finite().optional(),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(['open', 'closed']),
}).passthrough()

const localSaleItemSchema = z.object({
  inventory_id: uuid,
  batch_id: uuid.nullable(),
  quantity: z.coerce.number().int().positive(),
  unit_price: money,
  line_total: money,
}).passthrough()

export const localSaleSchema = z.object({
  id: uuid,
  pharmacy_id: uuid,
  cashier_id: uuid,
  shift_id: uuid,
  subtotal: money,
  discount: money,
  total: money,
  payment_method: z.enum(['cash', 'bank_transfer', 'pharmacy_pos_terminal', 'other']),
  amount_tendered: money.nullable(),
  change_due: money.nullable(),
  status: z.enum(['pending', 'completed', 'cancelled']),
  created_at: z.string().datetime(),
  reservation_id: uuid.optional(),
  items: z.array(localSaleItemSchema).min(1),
}).passthrough()

export const posSyncSchema = z.object({
  shifts: z.array(localShiftSchema).default([]),
  sales: z.array(localSaleSchema).default([]),
}).refine(({ shifts, sales }) => shifts.length > 0 || sales.length > 0, {
  message: 'At least one shift or sale is required',
})
