import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')

describe('catalogue administrator review boundary', () => {
  it('server-gates the page and every staged-review API route', () => {
    const files = [
      'app/admin/catalogue-review/page.tsx',
      'app/api/admin/catalogue-review/route.ts',
      'app/api/admin/catalogue-review/[id]/decision/route.ts',
      'app/api/admin/catalogue-review/[id]/promote/route.ts',
      'app/api/admin/catalogue-review/products/route.ts',
    ]

    for (const file of files) {
      expect(source(file), file).toContain('getAuthorizedAdmin')
    }
    expect(source(files[0])).toContain("redirect(access.status === 401")
  })

  it('keeps approval and catalogue promotion as separate human actions', () => {
    const client = source('app/admin/catalogue-review/catalogue-review-client.tsx')

    expect(client).toContain("sendDecision(row, 'approved'")
    expect(client).toContain('/promote`')
    expect(client).toContain('Promote to catalogue')
    expect(client).not.toMatch(/bulk.{0,20}(approve|promote)/i)
  })

  it('uses an admin-only, idempotent, provenance-writing promotion RPC', () => {
    const migration = source('supabase/migrations/20260906000000_catalogue_admin_review.sql')

    expect(migration).toContain('CREATE TABLE public.catalogue_product_promotions')
    expect(migration).toContain('queue_id UUID NOT NULL UNIQUE')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.promote_catalogue_reconciliation_candidate')
    expect(migration).toContain('IF NOT public.authenticated_user_is_admin()')
    expect(migration).toContain("'idempotent_noop', TRUE")
    expect(migration).toContain('INSERT INTO public.catalogue_product_promotions')
    expect(migration.trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';$/)
  })

  it('does not carry the former unconditional route/applicant blockers', () => {
    const staging = source('supabase/migrations/20260905150000_catalogue_source_staging.sql')
    const reasonBuilder = staging.slice(
      staging.indexOf('reasons AS ('),
      staging.indexOf('INSERT INTO public.catalogue_reconciliation_queue'),
    )

    expect(reasonBuilder).not.toContain("'route_and_release_not_modelled_in_products'")
    expect(reasonBuilder).not.toContain("'applicant_authorization_not_modelled_in_products'")
  })
})
