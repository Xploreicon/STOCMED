import { escapeEmailHtml, renderBrandedEmail } from '@/lib/email/template'

export type EmailTemplate =
  | 'welcome'
  | 'password_reset'
  | 'sale_receipt'
  | 'daily_report'
  | 'refill_reminder'

type TemplateData = Record<string, string | number | undefined>

export function renderEmailTemplate(
  template: EmailTemplate,
  data: TemplateData,
  unsubscribeUrl: string,
) {
  const name = String(data.name || 'there')
  const content = {
    welcome: {
      subject: 'Welcome to StocMed',
      heading: `Welcome, ${name}`,
      body: 'Your StocMed account is ready. You can now find medication and manage your health tasks in one place.',
    },
    password_reset: {
      subject: 'Reset your StocMed password',
      heading: 'Reset your password',
      body: `Use this secure link to choose a new password: ${escapeEmailHtml(data.resetUrl)}`,
    },
    sale_receipt: {
      subject: `Your StocMed receipt ${String(data.receiptNumber ?? '')}`,
      heading: 'Sale receipt',
      body: `${escapeEmailHtml(data.pharmacyName)} received your payment of ₦${escapeEmailHtml(data.total)}. Receipt: ${escapeEmailHtml(data.receiptNumber)}.`,
    },
    daily_report: {
      subject: `StocMed daily report — ${String(data.date ?? '')}`,
      heading: 'Your daily report',
      body: `Sales: ₦${escapeEmailHtml(data.sales)}. Transactions: ${escapeEmailHtml(data.transactions)}. Low-stock items: ${escapeEmailHtml(data.lowStock)}.`,
    },
    refill_reminder: {
      subject: `Refill reminder for ${String(data.medication ?? '')}`,
      heading: 'Time to check your refill',
      body: `Your ${escapeEmailHtml(data.medication)} may be due for a refill. Confirm with your prescriber or pharmacist before making changes.`,
    },
  }[template]

  return renderBrandedEmail({
    subject: content.subject,
    heading: content.heading,
    bodyHtml: `<p style="margin:0">${content.body}</p>`,
    bodyText: content.body,
    unsubscribeUrl,
  })
}
