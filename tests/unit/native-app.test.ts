import { describe, expect, it } from 'vitest'
import {
  getLandingRedirect,
  getNativeRestrictedRedirect,
  isStocMedAppUserAgent,
  STOCMED_APP_USER_AGENT,
} from '@/lib/native-app'
import {
  isPatientLocation,
  renderNativeCompleteProfile,
  renderNativeSignup,
} from '@/lib/native-patient-pages'

describe('StocMed native app user-agent detection', () => {
  it('recognizes the configured Capacitor marker', () => {
    expect(isStocMedAppUserAgent(`Mozilla/5.0 ${STOCMED_APP_USER_AGENT}`)).toBe(true)
  })

  it('does not classify normal browsers as native app traffic', () => {
    expect(isStocMedAppUserAgent('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toBe(false)
    expect(isStocMedAppUserAgent(null)).toBe(false)
  })

  it('redirects restricted pharmacy routes server-side and terminates at the landing page', () => {
    expect(getNativeRestrictedRedirect('/pharmacy/dashboard', true)).toBe('/')
    expect(getNativeRestrictedRedirect('/admin', true)).toBe('/')
    expect(getNativeRestrictedRedirect('/insights', true)).toBe('/')
    expect(getNativeRestrictedRedirect('/', true)).toBeNull()
    expect(getLandingRedirect('pharmacy', true)).toBeNull()
  })

  it('preserves normal-browser and patient landing redirects', () => {
    expect(getNativeRestrictedRedirect('/pharmacy/dashboard', false)).toBeNull()
    expect(getLandingRedirect('pharmacy', false)).toBe('/pharmacy/dashboard')
    expect(getLandingRedirect('patient', true)).toBe('/dashboard')
  })
})

describe('native patient-only pages', () => {
  it('contains no pharmacy registration or navigation surface', () => {
    const html = `${renderNativeSignup()}${renderNativeCompleteProfile()}`
    expect(html).not.toMatch(/I'm a pharmacy|For pharmacies|Register your pharmacy/i)
    expect(html).not.toMatch(/Continue as pharmacy|role=pharmacy|href="\/pharmacy/i)
    expect(html).toContain('Create your patient account')
    expect(html).toContain('Finish your patient profile')
  })

  it('escapes reflected form values and accepts only listed locations', () => {
    const html = renderNativeSignup({ fullName: '"><script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(isPatientLocation('Lagos')).toBe(true)
    expect(isPatientLocation('Not a listed location')).toBe(false)
  })
})
