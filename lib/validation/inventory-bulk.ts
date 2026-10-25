import { z } from 'zod'
import { MAX_BULK_INVENTORY_ITEMS } from '@/lib/inventory-recovery'

export const inventoryBulkSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_BULK_INVENTORY_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each inventory item once'),
  action: z.enum(['remove', 'restore']),
  reason: z.string().trim().max(300).optional(),
}).refine((body) => body.action !== 'remove' || Boolean(body.reason), {
  message: 'Choose a reason for removing these items', path: ['reason'],
})
