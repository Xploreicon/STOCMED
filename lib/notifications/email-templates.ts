export type EmailTemplate =
  | 'welcome'
  | 'password_reset'
  | 'sale_receipt'
  | 'daily_report'
  | 'refill_reminder'

type TemplateData = Record<string, string | number | undefined>

const escape = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export function renderEmailTemplate(
  template: EmailTemplate,
  data: TemplateData,
  unsubscribeUrl: string,
) {
  const name = escape(data.name || 'there')
  const content = {
    welcome: {
      subject: 'Welcome to StocMed',
      heading: `Welcome, ${name}`,
      body: 'Your StocMed account is ready. You can now find medication and manage your health tasks in one place.',
    },
    password_reset: {
      subject: 'Reset your StocMed password',
      heading: 'Reset your password',
      body: `Use this secure link to choose a new password: ${escape(data.resetUrl)}`,
    },
    sale_receipt: {
      subject: `Your StocMed receipt ${escape(data.receiptNumber)}`,
      heading: 'Sale receipt',
      body: `${escape(data.pharmacyName)} received your payment of ₦${escape(data.total)}. Receipt: ${escape(data.receiptNumber)}.`,
    },
    daily_report: {
      subject: `StocMed daily report — ${escape(data.date)}`,
      heading: 'Your daily report',
      body: `Sales: ₦${escape(data.sales)}. Transactions: ${escape(data.transactions)}. Low-stock items: ${escape(data.lowStock)}.`,
    },
    refill_reminder: {
      subject: `Refill reminder for ${escape(data.medication)}`,
      heading: 'Time to check your refill',
      body: `Your ${escape(data.medication)} may be due for a refill. Confirm with your prescriber or pharmacist before making changes.`,
    },
  }[template]

  const html = `<!doctype html><html><body style="margin:0;background:#f5faf8;color:#17332d;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="font-size:22px;font-weight:700;color:#087f5b">StocMed</div>
    <div style="margin-top:20px;background:#fff;border:1px solid #dce9e4;border-radius:12px;padding:24px">
      <h1 style="font-size:24px;margin:0 0 12px">${content.heading}</h1>
      <p style="font-size:16px;line-height:1.6;margin:0">${content.body}</p>
    </div>
    <p style="font-size:12px;line-height:1.5;color:#657b74;margin-top:18px">You received this because you enabled StocMed product email. <a href="${escape(unsubscribeUrl)}" style="color:#087f5b">Unsubscribe</a>.</p>
  </div></body></html>`
  const text = `${content.heading}\n\n${content.body}\n\nUnsubscribe: ${unsubscribeUrl}`
  return { subject: content.subject, html, text }
}
