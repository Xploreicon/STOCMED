import { escapeEmailHtml, renderBrandedEmail } from '@/lib/email/template'

export type WelcomeRole = 'patient' | 'pharmacy'

export function renderWelcomeEmail(input: {
  role: WelcomeRole
  name: string
  pharmacyName?: string | null
  siteUrl: string
}) {
  const name = input.name || 'there'
  if (input.role === 'pharmacy') {
    const pharmacyName = escapeEmailHtml(input.pharmacyName || 'your pharmacy')
    return renderBrandedEmail({
      subject: 'Welcome to StocMed for pharmacies',
      preheader: 'Set up inventory, reservations, POS, and notification choices.',
      eyebrow: 'Pharmacy onboarding',
      heading: `Welcome, ${name}`,
      bodyHtml: `<p style="margin:0 0 14px">Your StocMed workspace for <strong>${pharmacyName}</strong> is ready.</p><p style="margin:0 0 10px">Start by adding or importing inventory so nearby patients can find medicines you have in stock. You can also manage reservations and point-of-sale activity from the pharmacy dashboard.</p><p style="margin:0">Email, SMS, and browser push remain under your control in Notification settings.</p>`,
      bodyText: `Your StocMed workspace for ${input.pharmacyName || 'your pharmacy'} is ready. Add or import inventory so nearby patients can find medicines you have in stock. You can also manage reservations and point-of-sale activity from the pharmacy dashboard. Email, SMS, and browser push remain under your control in Notification settings.`,
      cta: { label: 'Open pharmacy dashboard', href: `${input.siteUrl}/pharmacy/dashboard` },
      reason: 'This one-time service email confirms that your StocMed pharmacy account was created.',
    })
  }

  return renderBrandedEmail({
    subject: 'Welcome to StocMed',
    preheader: 'Find medication nearby, reserve stock, and manage prescriptions.',
    eyebrow: 'Patient onboarding',
    heading: `Welcome, ${name}`,
    bodyHtml: '<p style="margin:0 0 14px">StocMed helps you find medication at nearby pharmacies before you travel.</p><p style="margin:0 0 10px">Search by medicine name, compare available listings, and reserve eligible stock from a pharmacy. When a pharmacy needs a prescription, you can upload it securely during the reservation flow.</p><p style="margin:0">Availability and clinical suitability should always be confirmed with the pharmacy or your prescriber.</p>',
    bodyText: 'StocMed helps you find medication at nearby pharmacies before you travel. Search by medicine name, compare available listings, and reserve eligible stock from a pharmacy. When a pharmacy needs a prescription, you can upload it securely during the reservation flow. Availability and clinical suitability should always be confirmed with the pharmacy or your prescriber.',
    cta: { label: 'Search for medication', href: `${input.siteUrl}/dashboard` },
    reason: 'This one-time service email confirms that your StocMed patient account was created.',
  })
}
