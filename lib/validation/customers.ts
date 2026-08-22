import { z } from 'zod'

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(32).optional().default(''),
  email: z.union([z.string().trim().email().max(320), z.literal('')]).optional().default(''),
  consent_whatsapp: z.boolean().default(false),
  consent_sms: z.boolean().default(false),
  consent_email: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().default(''),
})
