export type BrandedEmailInput = {
  subject: string
  preheader?: string
  eyebrow?: string
  heading: string
  bodyHtml: string
  bodyText: string
  cta?: { label: string; href: string }
  unsubscribeUrl?: string
  reason?: string
}

export function escapeEmailHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderBrandedEmail(input: BrandedEmailInput) {
  const preheader = escapeEmailHtml(input.preheader || input.subject)
  const unsubscribe = input.unsubscribeUrl
    ? `<p style="margin:8px 0 0"><a href="${escapeEmailHtml(input.unsubscribeUrl)}" style="color:#087f5b;text-decoration:underline">Unsubscribe from these emails</a></p>`
    : ''
  const cta = input.cta
    ? `<p style="margin:24px 0 4px"><a href="${escapeEmailHtml(input.cta.href)}" style="display:inline-block;border-radius:8px;background:#087f5b;color:#fff;padding:12px 18px;font-size:14px;font-weight:700;text-decoration:none">${escapeEmailHtml(input.cta.label)}</a></p>`
    : ''
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 10px;color:#087f5b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeEmailHtml(input.eyebrow)}</p>`
    : ''
  const reason = escapeEmailHtml(
    input.reason || 'You received this email because you enabled StocMed email updates.',
  )

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5faf8;color:#17332d;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5faf8"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px"><tr><td style="padding:28px 20px">
      <div style="font-size:24px;font-weight:800;letter-spacing:-.03em;color:#087f5b">StocMed</div>
      <div style="margin-top:22px;border:1px solid #dce9e4;border-radius:14px;background:#fff;padding:28px">
        ${eyebrow}
        <h1 style="margin:0 0 16px;color:#17332d;font-size:26px;line-height:1.25">${escapeEmailHtml(input.heading)}</h1>
        <div style="color:#294b43;font-size:16px;line-height:1.65">${input.bodyHtml}</div>
        ${cta}
      </div>
      <div style="padding:12px 4px 0;color:#657b74;font-size:12px;line-height:1.55">
        <p style="margin:0">${reason}</p>${unsubscribe}
        <p style="margin:8px 0 0">StocMed · askstocmed.com</p>
      </div>
    </td></tr></table>
  </td></tr></table>
</body></html>`

  const text = [
    input.heading,
    '',
    input.bodyText,
    input.cta ? `\n${input.cta.label}: ${input.cta.href}` : '',
    '',
    input.reason || 'You received this email because you enabled StocMed email updates.',
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : '',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n').trim()

  return { subject: input.subject, html, text }
}
