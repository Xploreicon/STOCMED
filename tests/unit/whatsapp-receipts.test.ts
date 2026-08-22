import { describe, expect, it } from 'vitest'
import { buildWhatsAppReceiptLink } from '@/lib/receipts/whatsapp'

describe('WhatsApp receipt deep links', () => {
  it('normalizes a Nigerian local number and URL-encodes the receipt', () => {
    expect(buildWhatsAppReceiptLink('0803 123 4567', 'Total: ₦1,500\nThank you'))
      .toBe('https://wa.me/2348031234567?text=Total%3A%20%E2%82%A61%2C500%0AThank%20you')
  })

  it('rejects a number that cannot be safely routed', () => {
    expect(() => buildWhatsAppReceiptLink('1234', 'Receipt')).toThrow(/valid Nigerian/)
  })
})
