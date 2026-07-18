'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Pharmacy = {
  pharmacy_name: string
  address: string
  phone: string
}

type Hold = {
  id: string
  quantity: number
  status: string
  expires_at: string
  pickup_code: string
  pharmacies: Pharmacy | null
  pharmacy_inventory: {
    products: {
      generic_name: string
      brand_name: string | null
      strength: string | null
    } | null
  } | null
}

type LinkedReservation = {
  id: string
  pickup_code: string
  status: string
  expires_at: string
}

type PrescriptionSubmission = {
  id: string
  product_name: string
  requested_quantity: number
  status: string
  review_notes: string | null
  created_at: string
  reviewed_at: string | null
  destination_pharmacy_id: string
  pharmacies: Pharmacy | null
  reservations: LinkedReservation | null
}

type ResourceResult = {
  ok: boolean
  status: number
  data: Record<string, unknown> | null
}

const fetchResource = async (path: string): Promise<ResourceResult> => {
  const response = await fetch(path)
  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}

const loadErrorMessage = (status?: number) => {
  if (status === 401) return 'Please sign in to view your reservations.'
  return 'We could not load this information. Check your connection and try again.'
}

const formatDate = (value: string) => new Date(value).toLocaleString([], {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export default function PatientReservationsPage() {
  const [holds, setHolds] = useState<Hold[]>([])
  const [submissions, setSubmissions] = useState<PrescriptionSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [holdsError, setHoldsError] = useState<string | null>(null)
  const [submissionsError, setSubmissionsError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setHoldsError(null)
    setSubmissionsError(null)

    const [holdsResult, submissionsResult] = await Promise.allSettled([
      fetchResource('/api/reservations'),
      fetchResource('/api/reservations/prescription'),
    ])

    if (holdsResult.status === 'fulfilled' && holdsResult.value.ok) {
      setHolds((holdsResult.value.data?.reservations as Hold[] | undefined) ?? [])
    } else {
      const status = holdsResult.status === 'fulfilled' ? holdsResult.value.status : undefined
      setHoldsError(loadErrorMessage(status))
    }

    if (submissionsResult.status === 'fulfilled' && submissionsResult.value.ok) {
      setSubmissions((submissionsResult.value.data?.submissions as PrescriptionSubmission[] | undefined) ?? [])
    } else {
      const status = submissionsResult.status === 'fulfilled' ? submissionsResult.value.status : undefined
      setSubmissionsError(loadErrorMessage(status))
    }

    if (mode === 'initial') setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void load('initial')
    const timer = window.setInterval(() => void load('refresh'), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const cancel = async (id: string) => {
    setCancellingId(id)
    try {
      const response = await fetch('/api/reservations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        toast.error(data?.error || 'Could not cancel hold')
        return
      }
      toast.success('Hold cancelled')
      await load('refresh')
    } catch {
      toast.error('Could not cancel hold')
    } finally {
      setCancellingId(null)
    }
  }

  const active = useMemo(
    () => holds.filter((hold) => hold.status === 'active' && new Date(hold.expires_at) > new Date()),
    [holds],
  )
  const activeHoldIds = useMemo(() => new Set(active.map((hold) => hold.id)), [active])

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">My reservations</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Track pickup holds and prescriptions sent to a pharmacy for review.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void load('refresh')}
          disabled={loading || refreshing}
          className="gap-2 bg-white"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          Loading your reservations…
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <section aria-labelledby="active-holds-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id="active-holds-heading" className="text-lg font-semibold text-ink">Active pickup holds</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Give the pickup code at the counter before the hold expires.
                </p>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted">
                {active.length}
              </span>
            </div>

            {holdsError ? (
              <div className="mt-4 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                <p>{holdsError}</p>
                <Button variant="outline" onClick={() => void load('refresh')} className="mt-3 gap-2 bg-white">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            ) : active.length === 0 ? (
              <div className="mt-4 rounded-card border border-dashed border-border py-10 text-center text-sm text-ink-muted">
                <Clock3 className="mx-auto mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                You have no active pickup holds.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {active.map((hold) => {
                  const product = hold.pharmacy_inventory?.products
                  const pharmacy = hold.pharmacies
                  return (
                    <article key={hold.id} id={`hold-${hold.id}`} className="rounded-card border border-border bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-ink">
                            {hold.quantity} × {product?.brand_name || product?.generic_name || 'Medication'}
                          </h3>
                          {product?.strength && <p className="mt-1 text-sm text-ink-muted">{product.strength}</p>}
                        </div>
                        <span className="rounded-button bg-primary px-3 py-1.5 text-sm font-bold text-white" aria-label={`Pickup code ${hold.pickup_code}`}>
                          {hold.pickup_code}
                        </span>
                      </div>
                      {pharmacy && (
                        <>
                          <p className="mt-3 flex gap-2 text-sm text-ink-muted">
                            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            {pharmacy.pharmacy_name}, {pharmacy.address}
                          </p>
                          <p className="mt-2 flex gap-2 text-sm font-medium text-warning">
                            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Collect by {formatDate(hold.expires_at)}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {pharmacy.phone && (
                              <a href={`tel:${pharmacy.phone}`} className="inline-flex h-10 items-center gap-2 rounded-button border border-border px-3 text-sm font-medium text-ink">
                                <Phone className="h-4 w-4" aria-hidden="true" />
                                Call pharmacy
                              </a>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => cancel(hold.id)}
                              disabled={cancellingId === hold.id}
                              className="gap-2 text-danger"
                            >
                              {cancellingId === hold.id
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                : <XCircle className="h-4 w-4" aria-hidden="true" />}
                              {cancellingId === hold.id ? 'Cancelling…' : 'Cancel hold'}
                            </Button>
                          </div>
                        </>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="prescription-requests-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id="prescription-requests-heading" className="text-lg font-semibold text-ink">Prescription requests</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  The destination pharmacy&apos;s superintendent pharmacist makes each decision.
                </p>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted">
                {submissions.length}
              </span>
            </div>

            <div className="mt-4 flex gap-3 rounded-card border border-border bg-surface p-4 text-sm text-ink-muted">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="leading-relaxed">
                Prescription files stay private. Access is limited to the destination pharmacist and authorized,
                logged StocMed oversight. Files are removed after the configured retention period.
              </p>
            </div>

            {submissionsError ? (
              <div className="mt-4 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                <p>{submissionsError}</p>
                <Button variant="outline" onClick={() => void load('refresh')} className="mt-3 gap-2 bg-white">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            ) : submissions.length === 0 ? (
              <div className="mt-4 rounded-card border border-dashed border-border py-10 text-center text-sm text-ink-muted">
                <FileText className="mx-auto mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                You have no prescription requests.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {submissions.map((submission) => {
                  const normalizedStatus = submission.status.toLowerCase()
                  const isRejected = normalizedStatus === 'rejected'
                  const isVerified = normalizedStatus === 'verified' || normalizedStatus === 'approved'
                  const isPending = !isRejected && !isVerified
                  const linkedHold = submission.reservations
                  const linkedHoldAlreadyShown = Boolean(linkedHold && activeHoldIds.has(linkedHold.id))
                  const linkedHoldIsActive = Boolean(
                    linkedHold?.status === 'active' && new Date(linkedHold.expires_at) > new Date(),
                  )
                  const pharmacy = submission.pharmacies

                  return (
                    <article key={submission.id} className="rounded-card border border-border bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-ink">
                            {submission.requested_quantity} × {submission.product_name || 'Prescription medicine'}
                          </h3>
                          <p className="mt-1 text-sm text-ink-muted">
                            {pharmacy?.pharmacy_name || 'Destination pharmacy'} · Submitted {formatDate(submission.created_at)}
                          </p>
                        </div>
                        <span className={isRejected
                          ? 'inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700'
                          : isVerified
                            ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700'
                            : 'inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700'}>
                          {isRejected
                            ? <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            : isVerified
                              ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
                          {isRejected ? 'Not approved' : isVerified ? 'Approved' : 'Pending review'}
                        </span>
                      </div>

                      {isPending && (
                        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                          Waiting for the destination pharmacy&apos;s superintendent pharmacist to review the request.
                          No stock is held until approval.
                        </p>
                      )}

                      {isRejected && (
                        <div className="mt-3 rounded-button bg-red-50 p-3 text-sm text-red-800">
                          <p className="font-medium">Consult or call the pharmacy before deciding what to do next.</p>
                          {submission.review_notes && (
                            <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                              <span className="font-medium">Pharmacist note:</span> {submission.review_notes}
                            </p>
                          )}
                        </div>
                      )}

                      {isVerified && linkedHoldAlreadyShown && linkedHold && (
                        <p className="mt-3 text-sm font-medium text-emerald-700">
                          Pickup hold created. Your active hold and pickup code are shown above.
                        </p>
                      )}

                      {isVerified && !linkedHoldAlreadyShown && linkedHold && linkedHoldIsActive && (
                        <div className="mt-3 rounded-button border border-emerald-200 bg-emerald-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-emerald-800">Pickup hold approved</span>
                            <span className="rounded-button bg-primary px-3 py-1.5 text-sm font-bold text-white" aria-label={`Pickup code ${linkedHold.pickup_code}`}>
                              {linkedHold.pickup_code}
                            </span>
                          </div>
                          <p className="mt-2 flex gap-2 text-sm text-emerald-800">
                            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Collect by {formatDate(linkedHold.expires_at)}
                          </p>
                        </div>
                      )}

                      {isVerified && !linkedHoldAlreadyShown && linkedHold && !linkedHoldIsActive && (
                        <p className="mt-3 text-sm text-ink-muted">
                          The linked pickup hold is {linkedHold.status}. Contact the pharmacy if you still need this medicine.
                        </p>
                      )}

                      {isVerified && !linkedHold && (
                        <p className="mt-3 text-sm text-ink-muted" role="status">
                          Approved. Your pickup hold is being prepared; refresh shortly for the pickup code.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-light">
                        {submission.reviewed_at && <span>Reviewed {formatDate(submission.reviewed_at)}</span>}
                        {pharmacy?.address && <span>{pharmacy.address}</span>}
                        {pharmacy?.phone && (
                          <a href={`tel:${pharmacy.phone}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                            Call pharmacy
                          </a>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
