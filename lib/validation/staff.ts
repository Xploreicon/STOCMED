import { z } from 'zod'

export const staffPermissionsSchema = z.object({
  can_sell: z.boolean(),
  can_adjust_stock: z.boolean(),
  can_view_reports: z.boolean(),
  can_change_prices: z.boolean(),
  can_refund: z.boolean(),
}).strict()

export const staffInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.enum(['owner', 'pharmacist', 'technician', 'cashier']),
  permissions: staffPermissionsSchema,
  pin: z.string().regex(/^\d{4,6}$/).optional(),
})
