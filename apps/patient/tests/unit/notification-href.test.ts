import { describe, expect, it } from 'vitest'
import { getNotificationHref } from '@/lib/notifications/in-app'

describe('packaged patient notification destinations', () => {
  it('preserves known patient paths, query and fragment', () => {
    expect(getNotificationHref({ href: '/reservations/?id=hold-1#pickup' })).toBe('/reservations/?id=hold-1#pickup')
    expect(getNotificationHref({ route: '/chat?q=Coartem&location=Yaba' })).toBe('/chat?q=Coartem&location=Yaba')
  })
  it.each(['/pharmacy/dashboard', '/admin/users', '/insights', '/design-system', '/settings/unknown',
    '//example.test', '/\\example.test', 'https://askstocmed.com/profile', '/history/../pharmacy/dashboard'])('rejects non-patient destination %s', href => {
    expect(getNotificationHref({ href })).toBeNull()
  })
  it.each([null, [], 'profile', { href: 123 }, {}])('rejects missing or malformed payload %j', data => {
    expect(getNotificationHref(data)).toBeNull()
  })
})
