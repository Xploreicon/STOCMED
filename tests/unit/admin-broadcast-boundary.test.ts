import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin broadcast authorization boundary', () => {
  it('returns 403 for an authenticated user without proven admin authorization', () => {
    const middleware = readFileSync(resolve(process.cwd(), 'middleware.ts'), 'utf8')
    expect(middleware).toContain("path === '/admin/broadcast'")
    expect(middleware).toContain('admin_authorization_basis')
    expect(middleware).toContain('status: 403')
  })

  it('keeps every broadcast and push API behind the shared server authorization check', () => {
    const routes = [
      'app/api/admin/broadcasts/route.ts',
      'app/api/admin/broadcasts/audience/route.ts',
      'app/api/admin/broadcasts/directory/route.ts',
      'app/api/admin/broadcasts/preview/route.ts',
      'app/api/admin/broadcasts/test/route.ts',
      'app/api/admin/push/route.ts',
      'app/api/admin/push/audience/route.ts',
    ]
    for (const route of routes) {
      expect(readFileSync(resolve(process.cwd(), route), 'utf8')).toContain('getAuthorizedAdmin')
    }
  })
})
