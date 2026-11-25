import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { sourceRoot, verifyProvenance, verifyRepositoryProvenance } from '../../scripts/check-drift.mjs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const row = { source: 'components/card.tsx', sourceSha256: hash('original upstream'), targets: ['components/card.tsx'], mode: 'copied' }

describe('copied-source drift detection', () => {
  it('resolves the repository root correctly and verifies every recorded real source without changing it', () => {
    expect(sourceRoot).toBe(fileURLToPath(new URL('../../../../', import.meta.url)))
    const manifest = JSON.parse(readFileSync(new URL('../../provenance.json', import.meta.url), 'utf8'))
    const result = verifyRepositoryProvenance(manifest)
    expect(result.passed).toBe(true)
    expect(result.sourceCount).toBeGreaterThan(0)
    expect(result.failures).toEqual([])
  })

  it('distinguishes matching snapshots from changed upstream bytes', () => {
    expect(verifyProvenance([row], () => 'original upstream').passed).toBe(true)
    const changed = verifyProvenance([row], () => 'updated upstream')
    expect(changed.passed).toBe(false)
    expect(changed.failures).toContainEqual(expect.objectContaining({ code: 'hash_mismatch', source: row.source, expected: row.sourceSha256, actual: hash('updated upstream'), targets: row.targets }))
  })

  it('checks package-owned source bytes without requiring a root copy', () => {
    const owned = { ...row, mode: 'package-owned' }
    const upstream = vi.fn()
    expect(verifyProvenance([owned], upstream, { readOwned: () => 'original upstream' }).passed).toBe(true)
    expect(upstream).not.toHaveBeenCalled()
    expect(verifyProvenance([owned], upstream, { readOwned: () => 'changed' }).failures)
      .toContainEqual(expect.objectContaining({ code: 'hash_mismatch' }))
    expect(verifyProvenance([owned], upstream, { readOwned: () => { throw new Error('missing') } }).failures)
      .toContainEqual(expect.objectContaining({ code: 'target_missing' }))
  })

  it('reports missing sources and missing child targets separately', () => {
    expect(verifyProvenance([row], () => { throw new Error('missing') }).failures).toContainEqual(expect.objectContaining({ code: 'source_missing' }))
    expect(verifyProvenance([row], () => 'original upstream', { targetExists: () => false }).failures).toContainEqual(expect.objectContaining({ code: 'target_missing' }))
  })

  it.each(['../outside.ts', '/absolute.ts', 'C:\\outside.ts', 'file:///outside.ts'])('rejects unsafe source %s before reading any source', source => {
    const reader = vi.fn(() => 'original upstream')
    expect(verifyProvenance([{ ...row, source }], reader).failures).toContainEqual(expect.objectContaining({ code: 'invalid_entry' }))
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects an escaping target and uncombined duplicate source entries', () => {
    expect(verifyProvenance([{ ...row, targets: ['../outside.ts'] }], () => 'original upstream').passed).toBe(false)
    expect(verifyProvenance([row, row], () => 'original upstream').failures).toContainEqual(expect.objectContaining({ code: 'duplicate_source' }))
  })
})
