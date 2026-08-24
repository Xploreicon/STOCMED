import { z } from 'zod'

export const broadcastTemplateSchema = z.enum([
  'announcement', 'product_update', 'medication_alert', 'custom',
])

export const broadcastAudienceSchema = z.object({
  kind: z.enum([
    'all_pharmacies', 'all_patients', 'premium_pharmacies',
    'free_pharmacies', 'individual_pharmacy', 'individual_user', 'custom',
  ]),
  pharmacy_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  city: z.string().trim().max(100).optional(),
  verification_status: z.enum(['provisional', 'full', 'revoked']).optional(),
  feature_key: z.string().trim().max(80).optional(),
  feature_enabled: z.boolean().optional(),
  last_active_after: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.kind === 'individual_pharmacy' && !value.pharmacy_id) {
    context.addIssue({ code: 'custom', message: 'Choose a pharmacy', path: ['pharmacy_id'] })
  }
  if (value.kind === 'individual_user' && !value.user_id) {
    context.addIssue({ code: 'custom', message: 'Choose a user', path: ['user_id'] })
  }
  if (
    value.kind === 'custom'
    && !value.city
    && !value.verification_status
    && !value.feature_key
    && !value.last_active_after
  ) {
    context.addIssue({ code: 'custom', message: 'Add at least one segment filter' })
  }
})

export const broadcastComposeSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body_markdown: z.string().trim().min(1).max(20000),
  template: broadcastTemplateSchema,
  audience: broadcastAudienceSchema,
  scheduled_at: z.string().datetime().nullable().optional(),
})

export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>
export type BroadcastCompose = z.infer<typeof broadcastComposeSchema>
