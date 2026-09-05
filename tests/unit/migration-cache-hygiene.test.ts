import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationsDirectory = join(root, 'supabase/migrations')
const migrationCutoff = '20260905150000'
const schemaChangingStatement = /\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+(?:table|function|type|view|materialized\s+view|index|policy|trigger|extension|schema|sequence)\b/i
const schemaReloadStatement = "NOTIFY pgrst, 'reload schema';"

describe('PostgREST schema-cache hygiene', () => {
  it('finishes schema-changing migrations at and after the cutoff with a cache reload', () => {
    const migrations = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql') && basename(file).slice(0, 14) >= migrationCutoff)
      .map((file) => ({
        file,
        sql: readFileSync(join(migrationsDirectory, file), 'utf8'),
      }))
      .filter(({ sql }) => schemaChangingStatement.test(sql))

    expect(migrations.length).toBeGreaterThan(0)

    for (const migration of migrations) {
      expect(migration.sql.trim().endsWith(schemaReloadStatement), migration.file).toBe(true)
    }
  })

  it('records the SQL-vs-REST-vs-app diagnostic rule', () => {
    const context = readFileSync(join(root, 'CONTEXT.md'), 'utf8')

    expect(context).toContain('raw SQL, raw PostgREST/REST, and the app endpoint')
    expect(context).toContain('raw REST is empty, wrong, or cannot see a new schema object')
    expect(context).toContain('raw REST is fast/correct, but the app endpoint is slow')
    expect(context).toContain('Raw SQL is itself slow or erroring')
  })
})
