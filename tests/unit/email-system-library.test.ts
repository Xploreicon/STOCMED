import { describe, expect, it } from 'vitest'
import { renderBroadcastEmail } from '@/lib/email/broadcast'
import { renderWelcomeEmail } from '@/lib/email/welcome'
import { getSearchDigestWindow } from '@/lib/notifications/digest-frequency'

describe('admin email composition', () => {
  it('supports sanitized HTML inside the shared branded template', () => {
    const email = renderBroadcastEmail({
      subject: 'Safe HTML update',
      bodyMarkdown: '<h2 onclick="alert(1)">Update</h2><a href="javascript:alert(1)">bad</a><p><strong>Safe copy</strong></p><script>alert(1)</script>',
      bodyFormat: 'html',
      template: 'announcement',
      unsubscribeUrl: 'https://askstocmed.com/u/signed-token',
    })

    expect(email.html).toContain('StocMed')
    expect(email.html).toContain('<strong>Safe copy</strong>')
    expect(email.html).not.toContain('onclick')
    expect(email.html).not.toContain('javascript:')
    expect(email.html).not.toContain('<script>')
    expect(email.text).toContain('Safe copy')
  })
})

describe('welcome emails', () => {
  it('renders patient onboarding actions with the branded template', () => {
    const email = renderWelcomeEmail({
      role: 'patient',
      name: '<Patient>',
      siteUrl: 'https://askstocmed.com',
    })
    expect(email.subject).toBe('Welcome to StocMed')
    expect(email.html).toContain('Search for medication')
    expect(email.html).toContain('&lt;Patient&gt;')
    expect(email.html).not.toContain('<Patient>')
    expect(email.text).toContain('reserve eligible stock')
  })

  it('renders pharmacy-specific onboarding without pretending it is a patient account', () => {
    const email = renderWelcomeEmail({
      role: 'pharmacy',
      name: 'Owner',
      pharmacyName: 'Example Pharmacy',
      siteUrl: 'https://askstocmed.com',
    })
    expect(email.subject).toContain('pharmacies')
    expect(email.html).toContain('Example Pharmacy')
    expect(email.html).toContain('Open pharmacy dashboard')
    expect(email.text).toContain('point-of-sale')
  })
})

describe('search-demand digest frequency', () => {
  const now = new Date('2026-09-05T06:30:00.000Z')

  it('defaults to one daily 24-hour window', () => {
    const window = getSearchDigestWindow(now)
    expect(window.frequency).toBe('daily')
    expect(window.due).toBe(true)
    expect(window.periodKey).toBe('2026-09-05')
    expect(window.until.getTime() - window.since.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('skips non-scheduled hours in daily mode', () => {
    expect(getSearchDigestWindow(new Date('2026-09-05T07:30:00.000Z')).due).toBe(false)
  })

  it('supports explicitly configured hourly aggregation', () => {
    const window = getSearchDigestWindow(now, { frequency: 'hourly' })
    expect(window.due).toBe(true)
    expect(window.periodKey).toBe('2026-09-05T06')
    expect(window.until.getTime() - window.since.getTime()).toBe(60 * 60 * 1000)
  })
})
