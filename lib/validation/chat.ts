import { z } from 'zod'

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  role: z.enum(['user', 'assistant']),
  metadata: z.object({ session_id: z.string().trim().max(200).optional() }).optional(),
})
