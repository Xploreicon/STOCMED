import { describe, expect, it } from 'vitest'
import { getNotificationHref } from '@/lib/notifications/in-app'

describe('in-app notification routing', () => {
  it.each([
    [{ href: '/pharmacy/inventory' }, '/pharmacy/inventory'],
    [{ route: '/reservations?status=ready' }, '/reservations?status=ready'],
    [{ path: '/profile#notifications' }, '/profile#notifications'],
  ])('accepts a same-origin route from %o', (data, expected) => {
    expect(getNotificationHref(data)).toBe(expected)
  })

  it.each([
    null,
    {},
    { href: 'https://attacker.example' },
    { href: '//attacker.example/path' },
    { href: '/\\attacker.example/path' },
    { href: 42 },
  ])('rejects an unsafe or invalid payload %o', data => {
    expect(getNotificationHref(data)).toBeNull()
  })
})
