import { describe, expect, it } from 'vitest'
import { formatOperatingHours, isPharmacyOpenNow } from '@/lib/pharmacy-hours'

describe('pharmacy hours', () => {
  it('reports ordinary same-day hours in Africa/Lagos', () => {
    expect(isPharmacyOpenNow('08:00', '21:00', new Date('2026-07-25T12:00:00Z'))).toBe(true)
    expect(isPharmacyOpenNow('08:00', '21:00', new Date('2026-07-25T22:00:00Z'))).toBe(false)
  })

  it('supports overnight opening windows', () => {
    expect(isPharmacyOpenNow('20:00', '06:00', new Date('2026-07-25T22:00:00Z'))).toBe(true)
    expect(isPharmacyOpenNow('20:00', '06:00', new Date('2026-07-25T10:00:00Z'))).toBe(false)
  })

  it('distinguishes unknown hours and formats saved hours', () => {
    expect(isPharmacyOpenNow(null, null)).toBeNull()
    expect(formatOperatingHours('08:00:00', '21:00:00')).toBe('8:00 AM–9:00 PM')
  })

  it('treats identical opening and closing times as a 24-hour pharmacy', () => {
    expect(isPharmacyOpenNow('00:00', '00:00', new Date('2026-07-25T12:00:00Z'))).toBe(true)
  })

  it('fails closed for malformed hours and excludes the exact closing boundary', () => {
    expect(isPharmacyOpenNow('not-a-time', '21:00')).toBeNull()
    expect(formatOperatingHours('08:00', '25:00')).toBeNull()
    expect(isPharmacyOpenNow('08:00', '21:00', new Date('2026-07-25T20:00:00Z'))).toBe(false)
  })
})
