import { describe, expect, it } from 'vitest'

import capacitorConfig from '@/capacitor.config'

const CANONICAL_WEB_ORIGIN = 'https://www.askstocmed.com'

describe('Android server-backed shell', () => {
  it('loads the canonical www origin without an apex redirect', () => {
    expect(capacitorConfig.server?.url).toBe(CANONICAL_WEB_ORIGIN)
  })

  it('flushes authentication cookies through Android CookieManager', () => {
    expect(capacitorConfig.plugins?.CapacitorCookies?.enabled).toBe(true)
  })
})
