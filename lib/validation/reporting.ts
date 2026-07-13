import { z } from 'zod'

export const reportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine(({ from, to }) => !from || !to || from <= to, {
  message: 'The report start date must not be after the end date',
})

export const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  dataset: z.enum(['sales', 'valuation']).default('sales'),
})

export const draftReorderSchema = z.object({
  product_id: z.string().uuid(),
})

export const quickBooksImportSchema = z.object({
  source: z.literal('quickbooks'),
  validate_only: z.boolean().optional(),
  matchedRows: z.array(z.object({
    selected_product_id: z.string().uuid(),
    mapped: z.object({
      generic_name: z.string().trim().min(1),
      sku: z.string().trim().optional().default(''),
      quantity: z.coerce.number().int().nonnegative(),
      unit_cost: z.coerce.number().finite().nonnegative().default(0),
      price: z.coerce.number().finite().nonnegative(),
    }).passthrough(),
  })).min(1).max(5_000),
})

export const expiryCaptureSchema = z.object({
  staging_id: z.string().uuid(),
  batch_number: z.string().trim().min(1).max(120),
  expiry_date: z.string().date().refine(value => value > new Date().toISOString().slice(0, 10), {
    message: 'Expiry date must be in the future',
  }),
})
