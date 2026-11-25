import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { expectedRoutes, verifyBoundary, verifyClientModuleInventory } from '../../scripts/check-boundary.mjs'

const temporaryRoots: string[] = []
function write(filename: string, text: string) {
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, text)
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'stocmed-i2-boundary-'))
  temporaryRoots.push(root)
  const child = path.join(root, 'patient')
  for (const route of expectedRoutes) write(path.join(child, 'app', route.slice(1), 'page.tsx'), 'export default function Page() { return null }\n')
  write(path.join(child, 'capacitor.config.json'), JSON.stringify({ webDir: 'out', ios: { appendUserAgent: 'StocMedApp/1.0' } }))
  return { root, child, page: path.join(child, 'app/about/page.tsx') }
}
function output(child: string) {
  for (const route of expectedRoutes) write(path.join(child, 'out', route.slice(1), 'index.html'), '<p>Patient page</p>')
}
afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('static patient package boundaries', () => {
  it('accepts exactly17 routes and copied public type-only imports without banning pharmacy data words', () => {
    const { child, page } = fixture()
    write(path.join(child, 'types/supabase.ts'), 'export type Database = { public: unknown }\n')
    write(page, "import type { Database } from '@/types/supabase'\nexport default function Page() { return <p>Nearby pharmacy inventory</p> }\n")
    const result = verifyBoundary(child)
    expect(result.passed).toBe(true)
    expect(result.routes).toHaveLength(17)
  })

  it.each(['server-only', 'next/headers', '@supabase/ssr', '@anthropic-ai/sdk', '@sentry/nextjs'])('rejects actual forbidden source import %s', name => {
    const { child, page } = fixture()
    write(page, "import dependency from '" + name + "'\nexport default function Page() { return null }\n")
    expect(verifyBoundary(child).failures.some(message => message.includes('forbidden import ' + name))).toBe(true)
  })

  it.each(["import value from '../../../outside'", "export { value } from '@/../outside'", "void import('@/../outside')"])('rejects escaping relative/alias imports and re-exports: %s', statement => {
    const { root, child, page } = fixture()
    write(path.join(root, 'outside.ts'), 'export const value = 1\n')
    write(page, statement + '\nexport default function Page() { return null }\n')
    expect(verifyBoundary(child).failures.some(message => message.includes('import leaves package'))).toBe(true)
  })

  it.each(['/absolute/outside.ts', 'C:/outside.ts', 'file:///outside.ts'])('rejects absolute module specifier %s', name => {
    const { child, page } = fixture()
    write(page, "import value from '" + name + "'\nexport default function Page() { return null }\n")
    expect(verifyBoundary(child).failures.some(message => message.includes('absolute import'))).toBe(true)
  })

  it('rejects a symlink whose apparently local import actually leaves the package', () => {
    const { root, child, page } = fixture()
    const outside = path.join(root, 'outside.ts')
    write(outside, 'export const value = 1\n')
    mkdirSync(path.join(child, 'lib'), { recursive: true })
    symlinkSync(outside, path.join(child, 'lib/escape.ts'))
    write(page, "import { value } from '@/lib/escape'\nexport default function Page() { return null }\n")
    expect(verifyBoundary(child).failures.some(message => message.includes('symlink leaves package'))).toBe(true)
  })

  it('rejects an extra page rather than silently exporting a broader app', () => {
    const { child } = fixture()
    write(path.join(child, 'app/extra/page.tsx'), 'export default function Page() { return null }\n')
    expect(verifyBoundary(child).failures.some(message => message.startsWith('Unexpected routes:'))).toBe(true)
  })

  it.each(["const keyName = 'SUPABASE_SERVICE_ROLE_KEY'", "navigator.serviceWorker.register('/sw.js')"])('rejects private identifiers or service-worker registration in exported JS', payload => {
    const { child } = fixture()
    output(child)
    write(path.join(child, 'out/_next/static/chunks/unsafe.js'), payload)
    expect(verifyBoundary(child).failures.some(message => message.includes('excluded runtime or private configuration'))).toBe(true)
  })

  it('records the SDK SSR diagnostic literal without mistaking it for an actual SSR dependency', () => {
    const { child } = fixture()
    output(child)
    write(path.join(child, '.next/client-module-inventory.json'), JSON.stringify(['/repo/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js']))
    write(path.join(child, 'out/_next/static/chunks/auth.js'), 'throw new Error("Use @supabase/ssr for cookie session handling")')
    const result = verifyBoundary(child)
    expect(result.passed).toBe(true)
    expect(result.inventoryCount).toBe(1)
    expect(result.advisoryStrings).toContainEqual(expect.objectContaining({ file: 'out/_next/static/chunks/auth.js', needle: '@supabase/ssr' }))
  })

  it('does not claim dependency absence when a diagnostic appears but no build inventory exists', () => {
    const { child } = fixture()
    output(child)
    write(path.join(child, 'out/_next/static/chunks/auth.js'), 'throw new Error("Use @supabase/ssr for cookie session handling")')
    const result = verifyBoundary(child)
    expect(result.inventoryCount).toBeNull()
    expect(result.advisoryStrings[0].classification).toContain('not yet proven')
  })
})

describe('actual client-module inventory', () => {
  it.each([
    '/repo/node_modules/@supabase/ssr/dist/module/index.js',
    '/repo/node_modules/@anthropic-ai/sdk/index.mjs',
    '/repo/node_modules/@sentry/nextjs/build/index.js',
    '/repo/apps/patient/lib/supabase/server.ts',
    '/repo/app/(pharmacy)/pharmacy/dashboard/page.tsx',
    '/repo/components/pos/Till.tsx',
    '/repo/lib/pos/sync-engine.ts',
    '/repo/lib/admin/permissions.ts',
    '/repo/components/chat/SymptomIntakeForm.tsx',
    '/repo/components/providers/PharmacyFeaturesProvider.tsx',
  ])('rejects excluded resolved module %s', identifier => {
    expect(verifyClientModuleInventory([identifier])).toHaveLength(1)
  })

  it('accepts public types, the browser Auth SDK and ordinary diagnostic words', () => {
    expect(verifyClientModuleInventory(['/repo/apps/patient/types/supabase.ts', '/repo/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js', 'SDK diagnostic recommends @supabase/ssr'])).toEqual([])
  })
})
