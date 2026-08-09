import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  getSpActionGate,
  getStructuredRpcFailure,
  hasSpAuthorization,
  requireSpAuthorization,
} from '@/lib/sp-authorization'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')

describe('SP authorization boundary', () => {
  it('ignores values that are not structured RPC failures', () => {
    expect(getStructuredRpcFailure(null)).toBeNull()
    expect(getStructuredRpcFailure([])).toBeNull()
    expect(getStructuredRpcFailure({ success: true })).toBeNull()
  })

  it('normalizes structured RPC failures and applies the fallback message', () => {
    expect(getStructuredRpcFailure({ success: false, code: 'DENIED', error: 'No access' })).toEqual({
      success: false,
      code: 'DENIED',
      error: 'No access',
    })
    expect(getStructuredRpcFailure({ success: false, code: '', error: '' }, 'Rejected')).toEqual({
      success: false,
      code: null,
      error: 'Rejected',
    })
  })

  it('reads an action gate only for the authenticated pharmacy and action', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { is_gated: true }, error: null })
    const actionEq = vi.fn(() => ({ maybeSingle }))
    const pharmacyEq = vi.fn(() => ({ eq: actionEq }))
    const select = vi.fn(() => ({ eq: pharmacyEq }))
    const from = vi.fn(() => ({ select }))

    await expect(getSpActionGate(
      { from } as never,
      '30000000-0000-4000-8000-000000000001',
      'financial_reports',
    )).resolves.toEqual({ isGated: true, error: null })

    expect(from).toHaveBeenCalledWith('pharmacy_sp_action_gates')
    expect(pharmacyEq).toHaveBeenCalledWith('pharmacy_id', '30000000-0000-4000-8000-000000000001')
    expect(actionEq).toHaveBeenCalledWith('action_key', 'financial_reports')
  })

  it('rejects an absent grant without calling the validation RPC', async () => {
    const rpc = vi.fn()
    await expect(hasSpAuthorization(
      { rpc } as never,
      '30000000-0000-4000-8000-000000000001',
      null,
      'data_export',
    )).resolves.toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts only a token confirmed by the scoped validation RPC', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: { message: 'database error' } })

    await expect(hasSpAuthorization(
      { rpc } as never,
      '30000000-0000-4000-8000-000000000001',
      'valid-token',
      'price_change',
    )).resolves.toBe(true)
    await expect(hasSpAuthorization(
      { rpc } as never,
      '30000000-0000-4000-8000-000000000001',
      'unverifiable-token',
      'price_change',
    )).resolves.toBe(false)
  })

  it('rejects a direct request without a grant and audits the failed check', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const request = new Request('http://localhost/sensitive-action') as never

    await expect(requireSpAuthorization(
      { rpc } as never,
      '30000000-0000-4000-8000-000000000001',
      request,
      'price_change',
      'test price change',
    )).resolves.toBe(false)

    expect(rpc).toHaveBeenCalledWith('verify_and_audit_sp_action', {
      p_pharmacy_id: '30000000-0000-4000-8000-000000000001',
      p_token: null,
      p_action: 'price_change',
      p_target_description: 'test price change',
    })
  })

  it('passes the supplied grant to the same server-side audit check', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const request = new Request('http://localhost/sensitive-action', {
      headers: { 'x-sp-authorization': 'valid-grace-window-token' },
    }) as never

    await expect(requireSpAuthorization(
      { rpc } as never,
      '30000000-0000-4000-8000-000000000001',
      request,
      'stock_adjustment',
      'test adjustment',
    )).resolves.toBe(true)

    expect(rpc).toHaveBeenCalledWith('verify_and_audit_sp_action', expect.objectContaining({
      p_token: 'valid-grace-window-token',
      p_action: 'stock_adjustment',
    }))
  })

  it.each([
    ['price changes and delisting', 'app/api/pharmacy/drugs/[id]/route.ts', ['update_pharmacy_inventory_item', 'delist_pharmacy_inventory_item', 'x-sp-authorization']],
    ['stock adjustments', 'app/api/pharmacy/drugs/[id]/adjust/route.ts', ['record_guarded_stock_adjustment', 'x-sp-authorization']],
    ['alternate stock adjustments', 'app/api/pharmacy/inventory/adjust/route.ts', ['record_guarded_stock_adjustment', 'x-sp-authorization']],
    ['selling-unit prices', 'app/api/pharmacy/inventory/[id]/selling-units/route.ts', ['create_inventory_selling_unit', 'remove_inventory_selling_unit', 'x-sp-authorization']],
    ['large discounts', 'app/api/pharmacy/pos/sync/route.ts', ['sync_pos_sale_with_shift', 'getStructuredRpcFailure']],
    ['grace-window validation', 'app/api/pharmacy/sp-authorization/validate/route.ts', ['hasSpAuthorization']],
    ['pharmacy settings', 'app/api/pharmacy/profile/route.ts', ['update_authenticated_pharmacy_profile', 'x-sp-authorization']],
    ['SP thresholds', 'app/api/pharmacy/sp-authorization/route.ts', ['update_sp_authorization_settings', 'currentCode']],
    ['voids and refunds', 'app/api/pharmacy/sales/[id]/reverse/route.ts', ['reverse_completed_sale', 'x-sp-authorization']],
  ])('%s is protected in its server mutation', (_label, path, markers) => {
    const contents = source(path)
    for (const marker of markers) expect(contents).toContain(marker)
  })

  it('keeps per-action checks inside the same database transaction as each write', () => {
    const migration = source('supabase/migrations/20260808030000_tier2_secure_write_rpcs.sql')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.record_guarded_stock_adjustment(')
    expect(migration).toContain('public.verify_gated_sp_action(')
    for (const action of [
      'price_change',
      'stock_adjustment',
      'large_discount',
      'delist_inventory',
      'restore_inventory',
      'void_or_refund',
      'pharmacy_settings',
      'financial_reports',
    ]) {
      expect(migration).toContain(`'${action}'`)
    }
  })
})
