import { markdownToEmailHtml, markdownToText } from '@/lib/email/markdown'
import { renderBrandedEmail } from '@/lib/email/template'

export type BroadcastTemplate = 'announcement' | 'product_update' | 'medication_alert' | 'custom'

export const BROADCAST_TEMPLATE_COPY: Record<BroadcastTemplate, {
  label: string
  subject: string
  body: string
  eyebrow: string
}> = {
  announcement: {
    label: 'Announcement',
    subject: 'An update from StocMed',
    body: 'Hello,\n\nWe have an important update to share with the StocMed community.\n\n## What you need to know\n\nAdd the announcement details here.',
    eyebrow: 'StocMed announcement',
  },
  product_update: {
    label: 'Product update',
    subject: 'What’s new in StocMed',
    body: 'Hello,\n\nWe have improved StocMed to make your day-to-day work simpler.\n\n## What changed\n\n- Add the first improvement\n- Explain who benefits\n- Include any action required',
    eyebrow: 'Product update',
  },
  medication_alert: {
    label: 'Medication alert',
    subject: 'Medication information update',
    body: 'Hello,\n\nPlease review this medication update carefully.\n\n## Important information\n\nAdd the verified alert details, affected products, and recommended action.',
    eyebrow: 'Medication alert',
  },
  custom: {
    label: 'Custom',
    subject: '',
    body: 'Hello,\n\nWrite your message here.',
    eyebrow: 'StocMed update',
  },
}

export function renderBroadcastEmail(input: {
  subject: string
  bodyMarkdown: string
  template: BroadcastTemplate
  unsubscribeUrl: string
}) {
  const template = BROADCAST_TEMPLATE_COPY[input.template]
  return renderBrandedEmail({
    subject: input.subject,
    preheader: input.subject,
    eyebrow: template.eyebrow,
    heading: input.subject,
    bodyHtml: markdownToEmailHtml(input.bodyMarkdown),
    bodyText: markdownToText(input.bodyMarkdown),
    unsubscribeUrl: input.unsubscribeUrl,
    reason: 'You received this administrative update because your email is associated with a StocMed account.',
  })
}
