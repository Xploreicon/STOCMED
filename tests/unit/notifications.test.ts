import { describe, expect, it } from 'vitest'
import { normalizeNigerianPhone, toTermiiPhone } from '@/lib/notifications/phone'
import { renderEmailTemplate } from '@/lib/notifications/email-templates'

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
})
