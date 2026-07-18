'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Building2, Clock3, Eye, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type VerificationRecord = {
  submission_id: string | null
  pharmacy_id: string
  pharmacy_name: string
  license_number: string
  verification_status: 'provisional' | 'full' | 'revoked'
  provisional_expires_at: string
  standards_version: string | null
  standards_accepted_at: string | null
  submitted_at: string | null
  decision: 'approved' | 'rejected' | null
  reviewed_at: string | null
  review_basis: string | null
}

type DocumentKind = 'premises_certificate' | 'superintendent_annual_licence'

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not submitted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return data?.error || fallback
}

export default function PharmacyVerificationQueuePage() {
  const [records, setRecords] = useState<VerificationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openedDocuments, setOpenedDocuments] = useState<Record<string, Set<DocumentKind>>>({})
  const [documentsBasis, setDocumentsBasis] = useState<Record<string, string>>({})
  const [standardsBasis, setStandardsBasis] = useState<Record<string, string>>({})
  const [rejectionBasis, setRejectionBasis] = useState<Record<string, string>>({})
  const [deciding, setDeciding] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/pharmacy-verifications', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(await readError(response, 'Could not load pharmacy verification queue.'))
      const payload = await response.json()
      setRecords(Array.isArray(payload?.records) ? payload.records : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load pharmacy verification queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const openDocument = async (record: VerificationRecord, kind: DocumentKind) => {
    if (!record.submission_id || opening) return
    const key = `${record.submission_id}:${kind}`
    const documentWindow = window.open('about:blank', '_blank')
    if (documentWindow) {
      documentWindow.opener = null
      documentWindow.document.body.textContent = 'Authorizing and recording access…'
    }
    setOpening(key)
    try {
      const response = await fetch(
        `/api/admin/pharmacy-verifications/${encodeURIComponent(record.submission_id)}/document`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ document_kind: kind }),
        }
      )
      if (!response.ok) throw new Error(await readError(response, 'Document access denied.'))
      const payload = await response.json()
      if (!payload?.url) throw new Error('The secure document URL was not returned.')

      setOpenedDocuments((current) => ({
        ...current,
        [record.submission_id!]: new Set(current[record.submission_id!] ?? []).add(kind),
      }))
      if (documentWindow && !documentWindow.closed) documentWindow.location.replace(payload.url)
      else window.location.assign(payload.url)
    } catch (openError) {
      documentWindow?.close()
      toast.error(openError instanceof Error ? openError.message : 'Could not open the document.')
    } finally {
      setOpening(null)
    }
  }

  const decide = async (record: VerificationRecord, decision: 'approve' | 'reject') => {
    if (!record.submission_id || deciding) return
    const opened = openedDocuments[record.submission_id] ?? new Set<DocumentKind>()
    if (!opened.has('premises_certificate') || !opened.has('superintendent_annual_licence')) {
      toast.error('Open both private documents through the logged review actions first.')
      return
    }

    const payload = decision === 'approve'
      ? {
          decision,
          pharmacy_id: record.pharmacy_id,
          documents_evidence_basis: documentsBasis[record.submission_id]?.trim(),
          standards_evidence_basis: standardsBasis[record.submission_id]?.trim(),
        }
      : {
          decision,
          pharmacy_id: record.pharmacy_id,
          basis: rejectionBasis[record.submission_id]?.trim(),
        }
    setDeciding(`${record.submission_id}:${decision}`)
    try {
      const response = await fetch(
        `/api/admin/pharmacy-verifications/${encodeURIComponent(record.submission_id)}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        }
      )
      if (!response.ok) throw new Error(await readError(response, 'Could not record the verification decision.'))
      toast.success(decision === 'approve' ? 'Pharmacy fully verified.' : 'Verification submission rejected and visibility revoked.')
      await loadRecords()
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : 'Could not record the verification decision.')
    } finally {
      setDeciding(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Provenance-authorized admin only
          </div>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Pharmacy verification</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
            Review both private evidence files and record separate document and standards bases. Format-valid PCN text is never treated as full verification.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadRecords()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          Loading verification queue…
        </div>
      ) : error ? (
        <div className="rounded-card border border-danger/20 bg-danger/5 p-6 text-sm text-danger" role="alert">
          <AlertTriangle className="mb-2 h-6 w-6" aria-hidden="true" />
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-sm text-ink-muted">
          No provisional or pending pharmacy verification records.
        </div>
      ) : (
        <div className="grid gap-4">
          {records.map((record) => {
            const submissionKey = record.submission_id ?? record.pharmacy_id
            const hasSubmission = Boolean(record.submission_id && record.submitted_at)
            const decided = Boolean(record.decision)
            return (
              <article key={submissionKey} className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
                      <h2 className="truncate text-base font-semibold text-ink">{record.pharmacy_name}</h2>
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink-muted">{record.license_number}</p>
                  </div>
                  <div className="text-xs text-ink-muted sm:text-right">
                    <p className="inline-flex items-center gap-1.5 font-semibold text-ink">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Provisional deadline {formatDate(record.provisional_expires_at)}
                    </p>
                    <p className="mt-1">Status: {record.verification_status}</p>
                  </div>
                </div>

                {!hasSubmission ? (
                  <p className="mt-4 rounded-button bg-surface px-3 py-2 text-sm text-ink-muted">
                    Required documents and standards acceptance have not been submitted.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4 border-t border-border pt-4">
                    <div className="grid gap-3 text-xs text-ink-muted sm:grid-cols-3">
                      <p><span className="font-semibold text-ink">Submitted:</span> {formatDate(record.submitted_at)}</p>
                      <p><span className="font-semibold text-ink">Standards:</span> {record.standards_version}</p>
                      <p><span className="font-semibold text-ink">Accepted:</span> {formatDate(record.standards_accepted_at)}</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['premises_certificate', 'superintendent_annual_licence'] as DocumentKind[]).map((kind) => (
                        <Button
                          key={kind}
                          type="button"
                          variant="outline"
                          disabled={opening !== null}
                          onClick={() => void openDocument(record, kind)}
                          className="gap-2"
                        >
                          {opening === `${record.submission_id}:${kind}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                          {kind === 'premises_certificate' ? 'Open PCN premises certificate' : 'Open SP annual licence'}
                        </Button>
                      ))}
                    </div>

                    {decided ? (
                      <div className="rounded-button border border-border bg-surface p-3 text-sm text-ink-muted">
                        <p className="font-semibold capitalize text-ink">{record.decision}</p>
                        <p className="mt-1">{record.review_basis}</p>
                        <p className="mt-1 text-xs">Reviewed {formatDate(record.reviewed_at)}</p>
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3 rounded-card border border-success/20 bg-success/5 p-3">
                          <label className="block text-xs font-semibold text-ink">
                            Document review evidence basis
                            <textarea
                              rows={2}
                              maxLength={2000}
                              value={documentsBasis[record.submission_id!] ?? ''}
                              onChange={(event) => setDocumentsBasis((current) => ({ ...current, [record.submission_id!]: event.target.value }))}
                              className="mt-1 w-full rounded-button border border-border bg-white px-3 py-2 font-normal outline-none focus:border-primary"
                            />
                          </label>
                          <label className="block text-xs font-semibold text-ink">
                            Standards agreement evidence basis
                            <textarea
                              rows={2}
                              maxLength={2000}
                              value={standardsBasis[record.submission_id!] ?? ''}
                              onChange={(event) => setStandardsBasis((current) => ({ ...current, [record.submission_id!]: event.target.value }))}
                              className="mt-1 w-full rounded-button border border-border bg-white px-3 py-2 font-normal outline-none focus:border-primary"
                            />
                          </label>
                          <Button
                            type="button"
                            disabled={deciding !== null || !documentsBasis[record.submission_id!]?.trim() || !standardsBasis[record.submission_id!]?.trim()}
                            onClick={() => void decide(record, 'approve')}
                            className="w-full"
                          >
                            {deciding === `${record.submission_id}:approve` ? 'Approving…' : 'Approve full verification'}
                          </Button>
                        </div>
                        <div className="space-y-3 rounded-card border border-danger/20 bg-danger/5 p-3">
                          <label className="block text-xs font-semibold text-ink">
                            Rejection / revocation basis
                            <textarea
                              rows={4}
                              maxLength={2000}
                              value={rejectionBasis[record.submission_id!] ?? ''}
                              onChange={(event) => setRejectionBasis((current) => ({ ...current, [record.submission_id!]: event.target.value }))}
                              className="mt-1 w-full rounded-button border border-border bg-white px-3 py-2 font-normal outline-none focus:border-danger"
                            />
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={deciding !== null || !rejectionBasis[record.submission_id!]?.trim()}
                            onClick={() => void decide(record, 'reject')}
                            className="w-full border-danger/30 text-danger hover:bg-danger/10"
                          >
                            {deciding === `${record.submission_id}:reject` ? 'Rejecting…' : 'Reject and revoke visibility'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
