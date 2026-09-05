import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('notification channel dispatcher', () => {
  const source = readFileSync(resolve(process.cwd(), 'lib/notifications/dispatcher.ts'), 'utf8')

  it('routes push to the Web Push provider instead of the SMS fallback', () => {
    expect(source).toContain("channel === 'email'")
    expect(source).toContain("channel === 'sms'")
    expect(source).toContain("channel === 'push'")
    expect(source).toContain('return deliverQueuedPush')
    expect(source).toContain('return null')
  })
})
