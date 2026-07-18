'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type AuditRecord = {
  id: string
  submission_id: string
  product_name: string
  requested_quantity: number
  status: string
  submitted_at: string
  reviewed_at: string | null
  review_notes: string | null
  purge_after: string
  destination_pharmacy_id: string
  pharmacy_name: string
  access_count: number
}

type RetentionPolicy = {
  retention_days: number | null
  is_confirmed?: boolean
  confirmed_by?: string | null
  confirmed_at?: string | null
  legal_basis: string | null
  updated_at?: string | null
}

type ErrorPayload = { error?: string }

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getPurgeLabel(value: string) {
  const purgeAt = new Date(value)
  if (Number.isNaN(purgeAt.getTime())) return 'Unavailable'

  const days = Math.ceil((purgeAt.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'Purge overdue'
  if (days === 0) return 'Purges today'
  if (days === 1) return 'Purges in 1 day'
  return `Purges in ${days} days`
}

function getStatusClasses(status: string) {
  switch (status.toLowerCase()) {
    case 'verified':
    case 'approved':
      return 'bg-success/10 text-success border-success/20'
    case 'rejected':
      return 'bg-danger/10 text-danger border-danger/20'
    case 'submitted':
    case 'under_review':
      return 'bg-warning/10 text-warning border-warning/20'
    default:
      return 'bg-surface text-ink-muted border-border'
  }
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null
  return payload?.error || fallback
}

export default function RxOversightPage() {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [openingSubmissionId, setOpeningSubmissionId] = useState<string | null>(null)
  const [canReview, setCanReview] = useState(false)
  const [openedForClinicalReview, setOpenedForClinicalReview] = useState<Set<string>>(new Set())
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState<{ submissionId: string; decision: 'verified' | 'rejected' } | null>(null)

  const [policy, setPolicy] = useState<RetentionPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [canManagePolicy, setCanManagePolicy] = useState(false)
  const [retentionDays, setRetentionDays] = useState('')
  const [legalBasis, setLegalBasis] = useState('')

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true)
    setRecordsError(null)

    try {
      const response = await fetch('/api/admin/prescription-audit', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not load prescription oversight records.'))
      }

      const payload = (await response.json()) as { records?: AuditRecord[]; can_review?: boolean }
      setRecords(Array.isArray(payload.records) ? payload.records : [])
      setCanReview(payload.can_review === true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load prescription oversight records.'
      setRecordsError(message)
    } finally {
      setRecordsLoading(false)
    }
  }, [])

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true)
    setPolicyError(null)
    setCanManagePolicy(false)

    try {
      const response = await fetch('/api/admin/prescription-retention', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not load the prescription retention policy.'))
      }

      const payload = (await response.json()) as { policy?: RetentionPolicy | null; can_manage?: boolean }
      const nextPolicy = payload.policy ?? null
      setPolicy(nextPolicy)
      setCanManagePolicy(payload.can_manage === true)
      setRetentionDays(nextPolicy?.retention_days ? String(nextPolicy.retention_days) : '')
      setLegalBasis(nextPolicy?.legal_basis ?? '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the prescription retention policy.'
      setPolicyError(message)
    } finally {
      setPolicyLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecords()
    void loadPolicy()
  }, [loadPolicy, loadRecords])

  const aggregates = useMemo(() => {
    const pending = records.filter((record) =>
      ['submitted', 'under_review'].includes(record.status.toLowerCase())
    ).length
    const decided = records.filter((record) =>
      ['verified', 'approved', 'rejected'].includes(record.status.toLowerCase())
    ).length
    const documentAccesses = records.reduce(
      (total, record) => total + Math.max(Number(record.access_count) || 0, 0),
      0
    )

    return { total: records.length, pending, decided, documentAccesses }
  }, [records])

  const statusOptions = useMemo(
    () => Array.from(new Set(records.map((record) => record.status))).sort(),
    [records]
  )

  const visibleRecords = useMemo(
    () =>
      statusFilter === 'all'
        ? records
        : records.filter((record) => record.status === statusFilter),
    [records, statusFilter]
  )

  const policyConfirmed = Boolean(
    policy?.is_confirmed &&
      policy.retention_days &&
      policy.retention_days > 0 &&
      policy.legal_basis?.trim()
  )

  const openDocument = async (submissionId: string) => {
    if (openingSubmissionId) return

    // Open the browsing context synchronously so mobile popup blockers do not
    // discard the explicit user action while the logged URL is being issued.
    const documentWindow = window.open('about:blank', '_blank')
    if (documentWindow) {
      documentWindow.opener = null
      documentWindow.document.title = 'Opening prescription…'
      documentWindow.document.body.textContent = 'Authorizing and recording access…'
    }

    setOpeningSubmissionId(submissionId)
    try {
      const response = await fetch(
        `/api/admin/prescription-audit/${encodeURIComponent(submissionId)}/document`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
        }
      )
      if (!response.ok) {
        throw new Error(await readError(response, 'Document access was not authorized.'))
      }

      const payload = (await response.json()) as { url?: string; access_context?: string }
      if (!payload.url) throw new Error('The secure document URL was not returned.')

      const documentUrl = new URL(payload.url, window.location.origin)
      if (!['http:', 'https:'].includes(documentUrl.protocol)) {
        throw new Error('The secure document URL was invalid.')
      }

      setRecords((current) =>
        current.map((record) =>
          record.submission_id === submissionId
            ? { ...record, access_count: (Number(record.access_count) || 0) + 1 }
            : record
        )
      )
      if (payload.access_context === 'stocmed_clinical_review') {
        setOpenedForClinicalReview((current) => new Set(current).add(submissionId))
      }

      if (documentWindow && !documentWindow.closed) {
        documentWindow.location.replace(documentUrl.toString())
      } else {
        window.location.assign(documentUrl.toString())
      }
    } catch (error) {
      documentWindow?.close()
      toast.error(error instanceof Error ? error.message : 'Could not open the prescription document.')
    } finally {
      setOpeningSubmissionId(null)
    }
  }

  const reviewPrescription = async (submissionId: string, decision: 'verified' | 'rejected') => {
    if (!canReview || reviewing) return
    if (!openedForClinicalReview.has(submissionId)) {
      toast.error('Open the prescription through the logged clinical-review action first.')
      return
    }

    setReviewing({ submissionId, decision })
    try {
      const response = await fetch(
        `/api/admin/prescription-audit/${encodeURIComponent(submissionId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            decision,
            notes: reviewNotes[submissionId]?.trim() || undefined,
          }),
        }
      )
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not record the clinical pre-review.'))
      }

      toast.success(decision === 'verified'
        ? 'Pickup hold authorized. Final dispensing remains with the destination pharmacy.'
        : 'Prescription request rejected.')
      setReviewNotes((current) => {
        const next = { ...current }
        delete next[submissionId]
        return next
      })
      await loadRecords()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record the clinical pre-review.')
    } finally {
      setReviewing(null)
    }
  }

  const savePolicy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (policySaving) return

    const days = Number(retentionDays)
    const basis = legalBasis.trim()
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setPolicyError('Retention must be a whole number between 1 and 3650 days.')
      return
    }
    if (!basis) {
      setPolicyError('A DPO/PCN/legal-approved basis is required before retention can be confirmed.')
      return
    }

    setPolicySaving(true)
    setPolicyError(null)
    try {
      const response = await fetch('/api/admin/prescription-retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ retention_days: days, legal_basis: basis }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not confirm the prescription retention policy.'))
      }

      const payload = (await response.json()) as { policy?: RetentionPolicy }
      if (!payload.policy) throw new Error('The updated retention policy was not returned.')

      setPolicy(payload.policy)
      setRetentionDays(payload.policy.retention_days ? String(payload.policy.retention_days) : '')
      setLegalBasis(payload.policy.legal_basis ?? '')
      toast.success('Prescription retention policy confirmed.')
    } catch (error) {
      setPolicyError(
        error instanceof Error ? error.message : 'Could not confirm the prescription retention policy.'
      )
    } finally {
      setPolicySaving(false)
    }
  }

  const clinicalReviewControls = (record: AuditRecord) => {
    if (!canReview || !['submitted', 'under_review'].includes(record.status.toLowerCase())) return null

    const hasClinicalOpen = openedForClinicalReview.has(record.submission_id)
    const isReviewing = reviewing?.submissionId === record.submission_id
    return (
      <div className="mt-3 space-y-2 text-left">
        <label className="block text-[11px] font-semibold text-ink-muted">
          Clinical pre-review notes
          <textarea
            value={reviewNotes[record.submission_id] ?? ''}
            onChange={(event) => setReviewNotes((current) => ({
              ...current,
              [record.submission_id]: event.target.value,
            }))}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full resize-y rounded-button border border-border bg-white px-2.5 py-2 text-xs font-normal text-ink outline-none focus:border-primary"
            placeholder="Record prescription and hold checks"
          />
        </label>
        {!hasClinicalOpen && (
          <p className="text-[10px] leading-4 text-warning">
            Open the document through the logged action before deciding.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasClinicalOpen || reviewing !== null}
            onClick={() => void reviewPrescription(record.submission_id, 'rejected')}
            className="border-danger/30 text-danger hover:bg-danger/5"
          >
            {isReviewing && reviewing.decision === 'rejected' ? 'Rejecting…' : 'Reject'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasClinicalOpen || reviewing !== null}
            onClick={() => void reviewPrescription(record.submission_id, 'verified')}
          >
            {isReviewing && reviewing.decision === 'verified' ? 'Authorizing…' : 'Authorize hold'}
          </Button>
        </div>
        <p className="text-[10px] leading-4 text-ink-light">
          Hold authorization is not dispensing approval. The destination pharmacy retains the final dispensing decision.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <section className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {canReview ? 'Licensed SP clinical pre-review' : 'Read-only oversight'}
          </div>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Prescription oversight</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
            {canReview
              ? 'The provenance-verified StocMed SP may pre-review a prescription and authorize a pickup hold during the pilot. This is not dispensing approval; final dispensing remains under the destination pharmacy’s direct professional supervision.'
              : 'Administrators can inspect the audit copy for compliance only. Opening a document is explicit and logged, and admin access never unlocks a clinical decision.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadRecords()}
          disabled={recordsLoading}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${recordsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </section>

      <section aria-label="Prescription audit summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Audit records', value: aggregates.total, icon: FileText },
          { label: 'Awaiting review', value: aggregates.pending, icon: Clock3 },
          { label: 'Pre-review decisions', value: aggregates.decided, icon: CheckCircle2 },
          { label: 'Logged document opens', value: aggregates.documentAccesses, icon: Eye },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-light">{label}</span>
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-3 text-2xl font-bold text-ink sm:text-3xl">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-card border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Model A audit records</h2>
            <p className="mt-1 text-xs text-ink-muted">No patient identity or document thumbnail is shown in this list.</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-button border border-border bg-white px-3 text-sm font-medium text-ink outline-none focus:border-primary"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>

        {recordsLoading ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-ink-muted">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            Loading oversight records…
          </div>
        ) : recordsError ? (
          <div className="m-4 flex flex-col items-center gap-3 rounded-card border border-danger/20 bg-danger/5 p-8 text-center sm:m-5">
            <AlertTriangle className="h-7 w-7 text-danger" aria-hidden="true" />
            <p className="text-sm font-medium text-danger">{recordsError}</p>
            <Button type="button" variant="outline" onClick={() => void loadRecords()}>
              Try again
            </Button>
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center">
            <FileText className="h-9 w-9 text-ink-light" aria-hidden="true" />
            <p className="text-sm font-semibold text-ink">No audit records for this status</p>
            <p className="text-xs text-ink-muted">Destination pharmacies continue to own the decision path.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {visibleRecords.map((record) => (
                <article key={record.id} className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-ink">{record.product_name}</h3>
                      <p className="mt-1 truncate text-xs text-ink-muted">{record.pharmacy_name}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${getStatusClasses(record.status)}`}>
                      {record.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <div>
                      <dt className="text-ink-light">Quantity</dt>
                      <dd className="mt-0.5 font-semibold text-ink">{record.requested_quantity}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-light">Logged opens</dt>
                      <dd className="mt-0.5 font-semibold text-ink">{record.access_count}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-light">Submitted</dt>
                      <dd className="mt-0.5 font-medium text-ink">{formatDate(record.submitted_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-light">Decision</dt>
                      <dd className="mt-0.5 font-medium text-ink">{formatDate(record.reviewed_at)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-ink-light">Retention</dt>
                      <dd className="mt-0.5 font-medium text-ink">
                        {getPurgeLabel(record.purge_after)} · {formatDate(record.purge_after)}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openDocument(record.submission_id)}
                    disabled={openingSubmissionId !== null}
                    className="w-full gap-2"
                  >
                    {openingSubmissionId === record.submission_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                    Open document (logged)
                  </Button>
                  {clinicalReviewControls(record)}
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1020px] text-left text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wide text-ink-light">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Destination pharmacy</th>
                    <th className="px-5 py-3 font-semibold">Prescription metadata</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Timeline</th>
                    <th className="px-5 py-3 font-semibold">Retention</th>
                    <th className="px-5 py-3 text-center font-semibold">Opens</th>
                    <th className="px-5 py-3 text-right font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleRecords.map((record) => (
                    <tr key={record.id} className="align-top hover:bg-surface/60">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-ink">{record.pharmacy_name}</p>
                        <p className="mt-1 font-mono text-[10px] text-ink-light">
                          {record.destination_pharmacy_id}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-ink">{record.product_name}</p>
                        <p className="mt-1 text-xs text-ink-muted">Quantity {record.requested_quantity}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${getStatusClasses(record.status)}`}>
                          {record.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-ink-muted">
                        <p><span className="font-semibold text-ink">Submitted:</span> {formatDate(record.submitted_at)}</p>
                        <p className="mt-1"><span className="font-semibold text-ink">Decided:</span> {formatDate(record.reviewed_at)}</p>
                      </td>
                      <td className="px-5 py-4 text-xs text-ink-muted">
                        <p className="font-semibold text-ink">{getPurgeLabel(record.purge_after)}</p>
                        <p className="mt-1">{formatDate(record.purge_after)}</p>
                      </td>
                      <td className="px-5 py-4 text-center font-semibold text-ink">{record.access_count}</td>
                      <td className="px-5 py-4 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openDocument(record.submission_id)}
                          disabled={openingSubmissionId !== null}
                          className="gap-2"
                        >
                          {openingSubmissionId === record.submission_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                          Open (logged)
                        </Button>
                        {clinicalReviewControls(record)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold text-ink">Prescription retention policy</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              Model A submission fails closed until a StocMed administrator records a legally approved
              duration and its basis. This screen does not supply or infer legal advice.
            </p>
          </div>

          {!policyLoading && (
            <div className={`rounded-card border px-4 py-3 text-sm lg:max-w-md ${policyConfirmed ? 'border-success/20 bg-success/5 text-success' : 'border-danger/20 bg-danger/5 text-danger'}`}>
              <div className="flex items-start gap-2">
                {policyConfirmed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <div>
                  <p className="font-semibold">{policyConfirmed ? 'Confirmed' : 'Unconfirmed — fail closed'}</p>
                  <p className="mt-1 text-xs leading-5">
                    {policyConfirmed
                      ? `${policy?.retention_days} days · confirmed ${formatDate(policy?.confirmed_at)}`
                      : 'Digital prescription reservation submissions must remain unavailable.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {policyLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            Loading retention policy…
          </div>
        ) : canManagePolicy ? (
          <form onSubmit={savePolicy} className="mt-6 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
            <label className="space-y-2 text-sm font-semibold text-ink">
              Retention duration (days)
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                required
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                className="h-11 w-full rounded-button border border-border bg-white px-3 text-sm font-normal text-ink outline-none focus:border-primary"
                placeholder="No default"
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-ink">
              Approved legal or regulatory basis
              <input
                type="text"
                required
                value={legalBasis}
                onChange={(event) => setLegalBasis(event.target.value)}
                className="h-11 w-full rounded-button border border-border bg-white px-3 text-sm font-normal text-ink outline-none focus:border-primary"
                placeholder="Record the DPO/PCN/legal approval reference"
              />
            </label>
            <Button
              type="submit"
              disabled={policySaving || !retentionDays || !legalBasis.trim()}
              className="h-11 gap-2 lg:min-w-40"
            >
              {policySaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm policy
            </Button>
          </form>
        ) : (
          <div className="mt-6 rounded-card border border-border bg-surface p-4 text-sm text-ink-muted">
            <p className="font-semibold text-ink">Read-only policy access</p>
            <p className="mt-1 leading-6">
              StocMed superintendent pharmacists can review the recorded retention policy. Only a StocMed
              administrator can confirm or change it.
            </p>
          </div>
        )}

        {policyError && (
          <p className="mt-4 flex items-start gap-2 rounded-card border border-danger/20 bg-danger/5 p-3 text-sm text-danger" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {policyError}
          </p>
        )}

        {policyConfirmed && policy?.legal_basis && (
          <div className="mt-5 border-t border-border pt-4 text-sm text-ink-muted">
            <span className="font-semibold text-ink">Recorded basis:</span> {policy.legal_basis}
            {policy.updated_at && <span className="mt-1 block text-xs text-ink-light">Last updated {formatDate(policy.updated_at)}</span>}
          </div>
        )}
      </section>
    </div>
  )
}
