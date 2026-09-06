import { describe, expect, it } from 'vitest'
import { parseControlledTestRecipientEmails } from '@/lib/admin/controlled-test-audience'

describe('controlled production test audience', () => {
  it('accepts exactly two unique normalized addresses', () => {
    expect(parseControlledTestRecipientEmails(' Test@One.com,second@example.com ')).toEqual([
      'test@one.com',
      'second@example.com',
    ])
  })

  it.each([
    undefined,
    '',
    'one@example.com',
    'one@example.com,one@example.com',
    'one@example.com,not-an-email',
    'one@example.com,two@example.com,three@example.com',
  ])('rejects an unsafe configuration: %s', value => {
    expect(() => parseControlledTestRecipientEmails(value)).toThrow(
      'exactly two unique email addresses',
    )
  })
})
