import { describe, expect, it } from 'vitest'
import { normalizeNigerianPhone, toTermiiPhone } from '@/lib/notifications/phone'
import { renderEmailTemplate } from '@/lib/notifications/email-templates'
import { renderBroadcastEmail } from '@/lib/email/broadcast'
import { renderSearchDemandDigest } from '@/lib/email/search-demand'

describe('Nigerian phone normalization', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['+2348031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected)
  })

  it('uses Termii international format without plus', () => {
    expect(toTermiiPhone('+2348031234567')).toBe('2348031234567')
  })

  it.each(['070123', '+2338031234567', '01234567890', '+2341234567890'])(
    'rejects invalid input %s',
    input => expect(() => normalizeNigerianPhone(input)).toThrow(),
  )
})

describe('email templates', () => {
  it('escapes user data and includes an unsubscribe path', () => {
    const email = renderEmailTemplate('welcome', {
      name: '<script>alert(1)</script>',
    }, 'https://askstocmed.com/unsubscribe')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.text).toContain('https://askstocmed.com/unsubscribe')
  })

  it('renders broadcast markdown through the branded template without raw HTML', () => {
    const email = renderBroadcastEmail({
      subject: 'Product update',
      template: 'product_update',
      bodyMarkdown: '## New tools\n\n- **Faster** stock counts\n- <script>alert(1)</script>',
      unsubscribeUrl: 'https://askstocmed.com/u/signed-token',
    })
    expect(email.html).toContain('StocMed')
    expect(email.html).toContain('<strong>Faster</strong>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).not.toContain('<script>')
    expect(email.text).toContain('https://askstocmed.com/u/signed-token')
  })

  it('renders stocked and unmet medication demand in one daily digest', () => {
    const email = renderSearchDemandDigest({
      pharmacyName: 'Example Pharmacy',
      unsubscribeUrl: 'https://askstocmed.com/u/digest-token',
      dashboardUrl: 'https://askstocmed.com/pharmacy/dashboard',
      items: [
        { medication: 'Amoxil', search_count: 8, in_stock: true, suggested_action: 'Check listing' },
        { medication: 'Metformin', search_count: 3, in_stock: false, suggested_action: 'Consider adding it' },
      ],
    })
    expect(email.subject).toBe('Demand near your pharmacy today')
    expect(email.html).toContain('Amoxil')
    expect(email.html).toContain('In stock')
    expect(email.html).toContain('Not stocked')
    expect(email.text).toContain('8 searches')
  })
})
