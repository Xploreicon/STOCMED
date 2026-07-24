import { z } from 'zod'

const optionalText = z.string().trim().max(200).optional().nullable()

export const inventoryItemSchema = z.object({
  item_type: z.enum(['medicine', 'store']).default('medicine'),
  product_id: z.string().uuid().optional().nullable(),
  tracks_expiry: z.boolean().default(true),
  item_name: optionalText,
  brand: optionalText,
  barcode: optionalText,
  unit_description: optionalText,
  store_category: optionalText,
  price: z.coerce.number().finite().positive(),
  unit_cost: z.coerce.number().finite().nonnegative().optional().nullable(),
  quantity_in_stock: z.coerce.number().int().nonnegative(),
  low_stock_threshold: z.coerce.number().int().nonnegative().default(10),
  batch_number: optionalText,
  expiry_date: z.string().date().optional().nullable(),
  pharmacy_image_url: z.string().url().optional().nullable(),
}).superRefine((item, ctx) => {
  if (item.item_type === 'medicine' && !item.product_id) {
    ctx.addIssue({ code: 'custom', path: ['product_id'], message: 'Select a catalogue product' })
  }
  if (item.item_type === 'store' && !item.item_name) {
    ctx.addIssue({ code: 'custom', path: ['item_name'], message: 'Item name is required' })
  }
  const tracksExpiry = item.item_type === 'medicine' || item.tracks_expiry
  if (tracksExpiry && !item.batch_number) {
    ctx.addIssue({ code: 'custom', path: ['batch_number'], message: 'Batch number is required' })
  }
  if (tracksExpiry && !item.expiry_date) {
    ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: 'Expiry date is required' })
  }
})

export type InventoryItemInput = z.infer<typeof inventoryItemSchema>
