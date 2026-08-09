'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { SP_ACTIONS } from '@/lib/sp-authorization'
import { clearCachedSpToken } from '@/lib/sp-authorization-client'

const ACTION_GATES = [
  { key: 'large_discount', label: 'Large discounts', detail: 'Require approval when a discount exceeds the threshold below.' },
  { key: 'price_change', label: 'Price changes', detail: 'Protect inventory prices and pack or carton prices.' },
  { key: 'stock_adjustment', label: 'Manual stock changes', detail: 'Protect restocks, returns, adjustments, write-offs, and expiry write-offs.' },
  { key: 'delist_inventory', label: 'Remove inventory listings', detail: 'Require approval before an item is delisted.' },
  { key: 'restore_inventory', label: 'Restore inventory listings', detail: 'Optionally protect restoring a delisted item.' },
  { key: 'void_or_refund', label: 'Voids and refunds', detail: 'Protect reversal of completed sales.' },
  { key: 'pharmacy_settings', label: 'Pharmacy profile settings', detail: 'Protect profile, hours, location, and logo changes.' },
  { key: 'data_export', label: 'Data exports', detail: 'Protect downloads of pharmacy and accounting data.' },
  { key: 'staff_accounts', label: 'Staff accounts', detail: 'Protect staff access changes when staff accounts are enabled.' },
] as const

type GateAction = (typeof ACTION_GATES)[number]['key']

type AuditRow = {
  id: string
  action: string
  target_description: string | null
  succeeded: boolean
  failure_reason: string | null
  created_at: string
}

type SpSettings = {
  configured: boolean
  discountThreshold: number
  graceMinutes: number
  requireFinancialReports: boolean
  lockedUntil: string | null
  gates: Array<{
    action_key: GateAction | 'financial_reports'
    is_gated: boolean
    updated_at: string
  }>
  audit: AuditRow[]
}

export function SpSettingsPanel() {
  const queryClient = useQueryClient()
  const [currentCode, setCurrentCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [discountThreshold, setDiscountThreshold] = useState('10')
  const [graceMinutes, setGraceMinutes] = useState('5')
  const [requireFinancialReports, setRequireFinancialReports] = useState(true)
  const [showSettingsAuthorization, setShowSettingsAuthorization] = useState(false)
  const [showRemoveAuthorization, setShowRemoveAuthorization] = useState(false)
  const [pendingGate, setPendingGate] = useState<{ action: GateAction; enabled: boolean } | null>(null)
  const refreshSettings = () => queryClient.invalidateQueries({ queryKey: ['sp-authorization-settings'] })

  const { data, isLoading } = useQuery<SpSettings>({
    queryKey: ['sp-authorization-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/sp-authorization')
      if (!response.ok) throw new Error('Could not load superintendent settings.')
      return response.json()
    },
  })

  useEffect(() => {
    if (!data) return
    setDiscountThreshold(String(data.discountThreshold))
    setGraceMinutes(String(data.graceMinutes))
    setRequireFinancialReports(data.requireFinancialReports)
  }, [data])

  const saveCode = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(newCode)) {
      toast.error('The new code must contain exactly 6 digits.')
      return
    }
    if (newCode !== confirmCode) {
      toast.error('The new codes do not match.')
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch('/api/pharmacy/sp-authorization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'set_code',
          newCode,
          ...(data?.configured ? { currentCode } : {}),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Could not save the code.')
      setCurrentCode('')
      setNewCode('')
      setConfirmCode('')
      await refreshSettings()
      toast.success(data?.configured ? 'Superintendent code changed' : 'Superintendent code set')
    } catch (error) {
      await refreshSettings()
      toast.error(error instanceof Error ? error.message : 'Could not save the code.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveControls = async (confirmedCode: string) => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/pharmacy/sp-authorization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountThreshold: Number(discountThreshold),
          graceMinutes: Number(graceMinutes),
          requireFinancialReports,
          currentCode: confirmedCode,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Could not save SP controls.')
      setShowSettingsAuthorization(false)
      await refreshSettings()
      toast.success('SP controls updated')
    } catch (error) {
      await refreshSettings()
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const saveGate = async (action: GateAction, enabled: boolean, confirmedCode: string | null) => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/pharmacy/sp-authorization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'set_gates',
          currentCode: confirmedCode,
          gates: { [action]: enabled },
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Could not update action protection.')
      await refreshSettings()
      toast.success(`${ACTION_GATES.find(gate => gate.key === action)?.label ?? 'Action'} protection ${enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      await refreshSettings()
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const requestGateChange = (action: GateAction, enabled: boolean) => {
    if (data?.configured) {
      setPendingGate({ action, enabled })
      return
    }
    void saveGate(action, enabled, null).catch(error => {
      toast.error(error instanceof Error ? error.message : 'Could not update action protection.')
    })
  }

  const removeCode = async (confirmedCode: string) => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/pharmacy/sp-authorization', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentCode: confirmedCode }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Could not remove the superintendent code.')
      for (const action of SP_ACTIONS) clearCachedSpToken(action)
      setCurrentCode('')
      setNewCode('')
      setConfirmCode('')
      setShowRemoveAuthorization(false)
      await refreshSettings()
      toast.success('Superintendent code removed')
    } catch (error) {
      await refreshSettings()
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  const lockoutExpiresAt = data?.lockedUntil ? new Date(data.lockedUntil) : null
  const lockoutIsActive = lockoutExpiresAt !== null
    && !Number.isNaN(lockoutExpiresAt.getTime())
    && lockoutExpiresAt.getTime() > Date.now()
  const formattedLockoutExpiry = lockoutIsActive
    ? new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      }).format(lockoutExpiresAt)
    : null

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-border bg-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Superintendent code</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              {data?.configured
                ? 'The 6-digit code is active. It is hashed, rate-limited, and never shown by StocMed.'
                : 'Set the 6-digit code carried by the Superintendent Pharmacist. Staff should not know or share it.'}
            </p>
          </div>
        </div>

        {lockoutIsActive && (
          <div className="mt-4 rounded-button border border-danger/25 bg-danger/5 p-3" role="alert">
            <p className="text-sm font-semibold text-danger">Superintendent code temporarily locked</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Too many incorrect attempts were entered. Try again after {formattedLockoutExpiry}.
            </p>
          </div>
        )}

        <form onSubmit={saveCode} className="mt-5 grid gap-4 sm:grid-cols-2">
          {data?.configured && (
            <label className="sm:col-span-2">
              <span className="text-sm font-medium text-ink">Current code</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={currentCode}
                onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-2 h-12 w-full rounded-button border border-border px-4 tracking-[0.3em] outline-none focus:border-primary"
              />
            </label>
          )}
          <label>
            <span className="text-sm font-medium text-ink">New 6-digit code</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              value={newCode}
              onChange={(event) => setNewCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-2 h-12 w-full rounded-button border border-border px-4 tracking-[0.3em] outline-none focus:border-primary"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-ink">Confirm code</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              value={confirmCode}
              onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-2 h-12 w-full rounded-button border border-border px-4 tracking-[0.3em] outline-none focus:border-primary"
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={isSaving} className="h-11 gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {data?.configured ? 'Change code' : 'Set code'}
            </Button>
            {data?.configured && (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setShowRemoveAuthorization(true)}
                className="h-11 text-danger"
              >
                Remove code
              </Button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-card border border-border bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-ink">Actions that need approval</h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          Each action starts off. {data?.configured
            ? 'Changing a protection requires the current superintendent code.'
            : 'You can choose protections now; they take effect after a superintendent code is set.'}
        </p>
        <div className="mt-4 divide-y divide-border rounded-button border border-border">
          {ACTION_GATES.map(gate => {
            const enabled = data?.gates.some(row => row.action_key === gate.key && row.is_gated) ?? false
            return (
              <label key={gate.key} className="flex items-start justify-between gap-4 p-3 sm:p-4">
                <span>
                  <span className="block text-sm font-medium text-ink">{gate.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-ink-muted">{gate.detail}</span>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={isSaving}
                  onChange={event => requestGateChange(gate.key, event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
              </label>
            )
          })}
        </div>
      </section>

      {data?.configured && (
        <section className="rounded-card border border-border bg-white p-4 sm:p-5">
          <h2 className="text-base font-semibold text-ink">Approval controls</h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">Keep routine selling fast; ask for the code only when it matters.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-sm font-medium text-ink">Discount threshold (%)</span>
              <input type="number" min="0" max="100" step="0.5" value={discountThreshold} onChange={(event) => setDiscountThreshold(event.target.value)} className="mt-2 h-12 w-full rounded-button border border-border px-4 outline-none focus:border-primary" />
            </label>
            <label>
              <span className="text-sm font-medium text-ink">Grace window (minutes)</span>
              <input type="number" min="1" max="15" step="1" value={graceMinutes} onChange={(event) => setGraceMinutes(event.target.value)} className="mt-2 h-12 w-full rounded-button border border-border px-4 outline-none focus:border-primary" />
            </label>
          </div>
          <label className="mt-4 flex items-start justify-between gap-4 rounded-button border border-border p-3">
            <span>
              <span className="block text-sm font-medium text-ink">Protect full financial reports</span>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">The dashboard shop-value summary remains visible.</span>
            </span>
            <input type="checkbox" checked={requireFinancialReports} onChange={(event) => setRequireFinancialReports(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          </label>
          <Button
            type="button"
            disabled={isSaving}
            onClick={() => setShowSettingsAuthorization(true)}
            className="mt-4"
          >
            Save controls
          </Button>
        </section>
      )}

      <section className="rounded-card border border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Authorization audit log</h2>
            <p className="mt-1 text-sm text-ink-muted">Every accepted and rejected use is permanent.</p>
          </div>
          <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted">
            {data?.audit.length ?? 0} recent events
          </span>
        </div>
        <div className="mt-4 divide-y divide-border overflow-hidden rounded-button border border-border">
          {(data?.audit ?? []).map((row) => (
            <div key={row.id} className="flex items-start gap-3 p-3">
              {row.succeeded
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium capitalize text-ink">{row.action.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {row.target_description || row.failure_reason || (row.succeeded ? 'Authorized' : 'Rejected')}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-light">
                <Clock3 className="h-3.5 w-3.5" />
                {new Date(row.created_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>
          ))}
          {!data?.audit.length && <p className="p-5 text-center text-sm text-ink-muted">No authorization activity yet.</p>}
        </div>
      </section>
      <SpAuthorizationModal
        open={showSettingsAuthorization}
        mode="current-code"
        description="Authorise changes to the pharmacy approval controls"
        onAuthorized={saveControls}
        onClose={() => setShowSettingsAuthorization(false)}
      />
      <SpAuthorizationModal
        open={showRemoveAuthorization}
        mode="current-code"
        description="Confirm the current code to remove superintendent protection. Your saved action choices remain dormant until a new code is set."
        onAuthorized={removeCode}
        onClose={() => setShowRemoveAuthorization(false)}
      />
      <SpAuthorizationModal
        open={pendingGate !== null}
        mode="current-code"
        description={pendingGate
          ? `${pendingGate.enabled ? 'Enable' : 'Disable'} approval for ${ACTION_GATES.find(gate => gate.key === pendingGate.action)?.label.toLowerCase()}.`
          : 'Change action protection.'}
        onAuthorized={async confirmedCode => {
          if (!pendingGate) return false
          await saveGate(pendingGate.action, pendingGate.enabled, confirmedCode)
        }}
        onClose={() => setPendingGate(null)}
      />
    </div>
  )
}
