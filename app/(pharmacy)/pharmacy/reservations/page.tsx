'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

type Reservation = {
  id: string
  pickup_code: string
  quantity: number
  status: 'active' | 'collected' | 'expired' | 'cancelled'
  reserved_at: string
  expires_at: string
  patient_name: string | null
  patient_phone: string | null
  product_name: string
  strength: string | null
  batch_number: string | null
  seen_at: string | null
}

type Prescription = {
  id: string
  product_name: string
  requested_quantity: number
  status: string
  created_at: string
  reviewed_at: string | null
  review_notes: string | null
  patient_name: string | null
  patient_phone: string | null
  reservation_id: string | null
  pickup_code: string | null
  destination_seen_at: string | null
}

type ReviewDecision = 'verified' | 'rejected'

function remainingTime(expiresAt: string, now: number) {
  const remainingSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export default function ReservationsPage() {
  const queryClient = useQueryClient()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [documentLoadingId, setDocumentLoadingId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ id: string; decision: ReviewDecision } | null>(null)
  const [releasingId, setReleasingId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const refreshSummary = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['pharmacy-reservations-summary'] })
  }, [queryClient])

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/pharmacy/reservations', { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Could not load the reservations queue')
      setReservations(data?.reservations ?? [])
      setPrescriptions(data?.prescriptions ?? [])
      await refreshSummary()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the reservations queue'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [refreshSummary])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const openDocument = async (prescription: Prescription) => {
    setActionError(null)
    setDocumentLoadingId(prescription.id)
    const documentWindow = window.open('about:blank', '_blank')
    try {
      const response = await fetch(`/api/pharmacy/prescriptions/${prescription.id}/document`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || typeof data?.url !== 'string') {
        throw new Error(data?.error || 'Could not open the prescription document')
      }
      if (documentWindow) {
        documentWindow.opener = null
        documentWindow.location.replace(data.url)
      } else {
        window.location.assign(data.url)
      }
    } catch (error) {
      documentWindow?.close()
      const message = error instanceof Error ? error.message : 'Could not open the prescription document'
      setActionError(message)
      toast.error(message)
    } finally {
      setDocumentLoadingId(null)
    }
  }

  const reviewPrescription = async (prescription: Prescription, decision: ReviewDecision) => {
    setActionError(null)
    setReviewing({ id: prescription.id, decision })
    try {
      const response = await fetch(`/api/pharmacy/prescriptions/${prescription.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          notes: notes[prescription.id]?.trim() || undefined,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Could not record the prescription decision')

      if (decision === 'verified') {
        const pickupCode = data?.reservation?.pickup_code
        toast.success(pickupCode ? `Approved. Hold ${pickupCode} was created.` : 'Approved. The patient hold was created.')
      } else {
        toast.success('Prescription rejected. The patient can now see the decision.')
      }
      setNotes((current) => {
        const next = { ...current }
        delete next[prescription.id]
        return next
      })
      await load()
      await refreshSummary()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not record the prescription decision'
      setActionError(message)
      toast.error(message)
    } finally {
      setReviewing(null)
    }
  }

  const cancel = async (id: string) => {
    setActionError(null)
    setReleasingId(id)
    try {
      const response = await fetch('/api/reservations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reason: 'Cancelled by pharmacy' }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Could not release the hold')
      toast.success('Hold released')
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not release the hold'
      setActionError(message)
      toast.error(message)
    } finally {
      setReleasingId(null)
    }
  }

  const pendingPrescriptions = prescriptions.filter(
    (prescription) => prescription.status === 'submitted' || prescription.status === 'under_review'
  )
  const active = reservations.filter(
    (reservation) => reservation.status === 'active' && new Date(reservation.expires_at).getTime() > now
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Reservations</h1>
          <p className="mt-1 text-sm text-ink-muted">Review prescriptions and keep active pickup holds moving.</p>
        </div>
        <Button
          onClick={() => void load(true)}
          variant="outline"
          className="gap-2"
          disabled={loading || refreshing}
          aria-label="Refresh reservations queue"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {loadError && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger/30 bg-[var(--danger-tint)] px-4 py-3 text-sm text-danger" role="alert">
          <span>{loadError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load(true)}>Try again</Button>
        </div>
      )}
      {actionError && (
        <div className="mb-5 rounded-card border border-danger/30 bg-[var(--danger-tint)] px-4 py-3 text-sm font-medium text-danger" role="alert">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted" role="status" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          Loading reservations queue…
        </div>
      ) : (
        <>
          <section className="mb-10" aria-labelledby="prescription-reviews-heading">
            <div className="mb-4 rounded-card border border-primary/25 bg-primary/5 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="prescription-reviews-heading" className="text-lg font-semibold text-ink">Prescription reviews</h2>
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-white">
                      {pendingPrescriptions.length} pending
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    Only this destination pharmacy&apos;s licensed superintendent pharmacist may approve or reject these requests. Approval atomically creates the stock hold and pickup code; StocMed is not an approval step.
                  </p>
                </div>
              </div>
            </div>

            {pendingPrescriptions.length === 0 ? (
              <div className="rounded-card border border-border bg-white py-10 text-center text-sm text-ink-muted">
                <FileCheck2 className="mx-auto mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                No prescription reviews are waiting.
              </div>
            ) : (
              <div className="grid gap-4">
                {pendingPrescriptions.map((prescription) => {
                  const isReviewing = reviewing?.id === prescription.id
                  const isUnseen = prescription.destination_seen_at === null
                  return (
                    <article
                      key={prescription.id}
                      className={`rounded-card border p-4 shadow-xs sm:p-5 ${
                        isUnseen ? 'border-primary/50 bg-primary/5' : 'border-border bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-ink">
                              {prescription.requested_quantity} x {prescription.product_name}
                            </h3>
                            {isUnseen && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">New</span>}
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold capitalize text-warning">
                              {prescription.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-ink-muted">
                            {prescription.patient_name || 'Patient'}
                            {prescription.patient_phone ? ` · ${prescription.patient_phone}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            Submitted <time dateTime={prescription.created_at}>{new Date(prescription.created_at).toLocaleString()}</time>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {prescription.patient_phone && (
                            <a
                              href={`tel:${prescription.patient_phone}`}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-button border border-border bg-white px-3 text-sm font-medium text-ink"
                            >
                              <Phone className="h-4 w-4" aria-hidden="true" />Call
                            </a>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-2"
                            onClick={() => void openDocument(prescription)}
                            disabled={documentLoadingId === prescription.id || isReviewing}
                            aria-label={`View prescription document for ${prescription.patient_name || prescription.product_name}`}
                          >
                            {documentLoadingId === prescription.id
                              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
                            View document
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4">
                        <label htmlFor={`review-notes-${prescription.id}`} className="mb-2 block text-sm font-medium text-ink">
                          Review notes <span className="font-normal text-ink-muted">(optional)</span>
                        </label>
                        <Textarea
                          id={`review-notes-${prescription.id}`}
                          value={notes[prescription.id] ?? ''}
                          onChange={(event) => setNotes((current) => ({ ...current, [prescription.id]: event.target.value }))}
                          maxLength={1000}
                          disabled={isReviewing}
                          placeholder="Record any reason or dispensing note for the audit trail."
                          className="bg-white"
                        />
                      </div>

                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2 border-[var(--danger)] text-danger hover:bg-[var(--danger-tint)]"
                          disabled={isReviewing || documentLoadingId === prescription.id}
                          onClick={() => void reviewPrescription(prescription, 'rejected')}
                        >
                          {reviewing?.id === prescription.id && reviewing.decision === 'rejected'
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <XCircle className="h-4 w-4" aria-hidden="true" />}
                          Reject
                        </Button>
                        <Button
                          type="button"
                          className="gap-2"
                          disabled={isReviewing || documentLoadingId === prescription.id}
                          onClick={() => void reviewPrescription(prescription, 'verified')}
                        >
                          {reviewing?.id === prescription.id && reviewing.decision === 'verified'
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                          Approve &amp; create hold
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="active-holds-heading">
            <div className="mb-5 flex items-center gap-3 rounded-card border border-primary/20 bg-surface px-4 py-3 text-sm text-ink">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary">
                <BellRing className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="active-holds-heading" className="font-semibold text-ink">Active pickup holds</h2>
                <p className="mt-0.5 text-ink-muted"><strong className="text-ink">{active.length}</strong> active {active.length === 1 ? 'hold' : 'holds'} need attention.</p>
              </div>
            </div>

            {active.length === 0 ? (
              <div className="py-12 text-center text-sm text-ink-muted">
                <Clock3 className="mx-auto mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                No active reservations.
              </div>
            ) : (
              <div className="grid gap-3">
                {active.map((reservation) => {
                  const isUnseen = reservation.seen_at === null
                  return (
                    <article
                      key={reservation.id}
                      className={`grid gap-4 rounded-card border p-4 sm:grid-cols-[1fr_auto] sm:items-center ${
                        isUnseen ? 'border-primary/50 bg-primary/5 shadow-sm' : 'border-border bg-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-button bg-primary px-2.5 py-1 text-sm font-semibold text-white">{reservation.pickup_code}</span>
                          <span className="text-base font-semibold text-ink">{reservation.quantity} x {reservation.product_name}</span>
                          {reservation.strength && <span className="text-sm text-ink-muted">{reservation.strength}</span>}
                          {isUnseen && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">New</span>}
                        </div>
                        <p className="mt-2 text-sm text-ink-muted">
                          {reservation.patient_name || 'Guest'}
                          {reservation.patient_phone ? ` · ${reservation.patient_phone}` : ''}
                          {reservation.batch_number ? ` · Batch ${reservation.batch_number}` : ''}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-warning">
                          <Clock3 className="h-4 w-4" aria-hidden="true" />
                          <span aria-live="off">Expires in {remainingTime(reservation.expires_at, now)}</span>
                          <span className="font-normal text-ink-muted">
                            · <time dateTime={reservation.expires_at}>{new Date(reservation.expires_at).toLocaleString()}</time>
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:flex-col">
                        <Link
                          href={`/pharmacy/pos?pickup=${encodeURIComponent(reservation.pickup_code)}`}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-button bg-primary px-3 text-sm font-bold text-white transition-colors hover:bg-[var(--primary-hover)]"
                        >
                          <ShoppingCart className="h-4 w-4" aria-hidden="true" />Collect in POS
                        </Link>
                        {reservation.patient_phone && (
                          <a href={`tel:${reservation.patient_phone}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-button border border-border bg-white px-3 text-sm font-medium text-ink">
                            <Phone className="h-4 w-4" aria-hidden="true" />Call
                          </a>
                        )}
                        <Button
                          onClick={() => void cancel(reservation.id)}
                          variant="outline"
                          className="gap-2 text-danger"
                          disabled={releasingId === reservation.id}
                        >
                          {releasingId === reservation.id
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <XCircle className="h-4 w-4" aria-hidden="true" />}
                          Release
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
