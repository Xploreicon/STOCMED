import { escapeEmailHtml, renderBrandedEmail } from '@/lib/email/template'

export type SearchDemandItem = {
  medication: string
  search_count: number
  in_stock: boolean
  suggested_action: string
}

export function renderSearchDemandDigest(input: {
  pharmacyName: string
  items: SearchDemandItem[]
  unsubscribeUrl: string
  dashboardUrl: string
}) {
  const rows = input.items.map(item => `<tr>
    <td style="padding:10px 8px;border-top:1px solid #e5eeeb;font-weight:700">${escapeEmailHtml(item.medication)}</td>
    <td style="padding:10px 8px;border-top:1px solid #e5eeeb;text-align:center">${Number(item.search_count)}</td>
    <td style="padding:10px 8px;border-top:1px solid #e5eeeb">${item.in_stock ? 'In stock' : 'Not stocked'}</td>
    <td style="padding:10px 8px;border-top:1px solid #e5eeeb">${escapeEmailHtml(item.suggested_action)}</td>
  </tr>`).join('')
  const bodyHtml = `<p style="margin:0 0 16px">Patients near <strong>${escapeEmailHtml(input.pharmacyName)}</strong> searched for these medications in the past 24 hours.</p>
    <div style="overflow-x:auto"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f1f7f5"><th align="left" style="padding:9px 8px">Medication</th><th style="padding:9px 8px">Searches</th><th align="left" style="padding:9px 8px">Your stock</th><th align="left" style="padding:9px 8px">Suggested action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
  const bodyText = [
    `Patients near ${input.pharmacyName} searched for these medications in the past 24 hours:`,
    '',
    ...input.items.map(item => `- ${item.medication}: ${item.search_count} search${item.search_count === 1 ? '' : 'es'}; ${item.in_stock ? 'in stock' : 'not stocked'}. ${item.suggested_action}.`),
  ].join('\n')

  return renderBrandedEmail({
    subject: 'Demand near your pharmacy today',
    eyebrow: 'Daily demand digest',
    heading: 'Demand near your pharmacy today',
    bodyHtml,
    bodyText,
    cta: { label: 'Review unmet demand', href: input.dashboardUrl },
    unsubscribeUrl: input.unsubscribeUrl,
    reason: 'You received this digest because medication-demand email is enabled for your pharmacy.',
  })
}
