'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  Loader2,
  PackagePlus,
  PencilLine,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type QueueType =
  | 'existing_identity_enrichment'
  | 'candidate_new_identity'
  | 'ambiguous_conflicting_match'
  | 'non_human_non_medicine_scope'
type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'held'
type ResolutionAction = 'new_identity' | 'existing_enrichment'

type Proposal = {
  generic_name: string | null
  brand_name: string | null
  manufacturer: string | null
  strength: string | null
  dosage_form: string | null
  category: string | null
  pack_size: string | null
  nafdac_number: string | null
  atc_code: string | null
  requires_prescription: boolean | null
  resolution_action: ResolutionAction | null
  target_product_id: string | null
}

type CatalogueProduct = {
  id: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  strength: string
  dosage_form: string | null
  category?: string | null
  pack_size: string | null
  nafdac_number: string | null
  atc_code?: string | null
  requires_prescription?: boolean
  is_verified: boolean
}

type ReviewRow = {
  id: string
  record_id: string
  queue_type: QueueType
  decision_status: DecisionStatus
  match_basis: string | null
  candidate_product_id: string | null
  conflict_reasons: string[]
  decision_notes: string | null
  proposal: Proposal
  resolved_conflict_reasons: string[]
  resolution_evidence: { summary?: string }
  approval_blockers: string[]
  can_approve: boolean
  can_quick_approve: boolean
  source: {
    status: string | null
    url: string | null
    quality_flags: string[]
    route: string | null
    applicant: string | null
    components: Array<{ ingredient_raw?: string; strength_raw?: string }>
    raw: Record<string, unknown>
  }
  existing_product: CatalogueProduct | null
  promotion: { product_id: string; action: string; promoted_at: string } | null
}

type QueuePayload = {
  counts: Partial<Record<QueueType, number>>
  total: number
  rows: ReviewRow[]
  dosage_forms: string[]
  categories: string[]
}

type EditDraft = {
  generic_name: string
  brand_name: string
  manufacturer: string
  strength: string
  dosage_form: string
  category: string
  pack_size: string
  nafdac_number: string
  atc_code: string
  requires_prescription: 'true' | 'false' | 'unknown'
  resolution_action: ResolutionAction | ''
  target_product_id: string
}

const PAGE_SIZE = 25
const buckets: Array<{ key: QueueType; label: string; tone: string }> = [
  { key: 'existing_identity_enrichment', label: 'Existing enrichments', tone: 'border-emerald-200 bg-emerald-50' },
  { key: 'candidate_new_identity', label: 'New identities', tone: 'border-blue-200 bg-blue-50' },
  { key: 'ambiguous_conflicting_match', label: 'Ambiguous / held', tone: 'border-amber-200 bg-amber-50' },
  { key: 'non_human_non_medicine_scope', label: 'Outside medicine scope', tone: 'border-slate-200 bg-slate-50' },
]

const ignoredConflictReasons = new Set([
  'route_and_release_not_modelled_in_products',
  'applicant_authorization_not_modelled_in_products',
  'missing_route',
  'missing_or_unresolved_route',
  'missing_manufacturer',
  'missing_or_unresolved_manufacturer',
  'missing_product_name',
])
const immutableConflictReasons = new Set([
  'source_inactive',
  'regulatory_alert_hold',
  'non_human_greenbook_scope',
  'market_observed_registration_unresolved',
  'market_non_medicine_or_unresolved_scope',
])
const immutableBlockers = new Set([
  'source_not_active',
  'source_inactive',
  'regulatory_alert_hold',
  'non_nafdac_human_source',
  'non_human_non_medicine_scope',
  'non_human_greenbook_scope',
  'market_observed_registration_unresolved',
  'market_non_medicine_or_unresolved_scope',
])

const diffFields: Array<{ key: keyof Proposal; label: string }> = [
  { key: 'generic_name', label: 'Ingredient / generic' },
  { key: 'brand_name', label: 'Product / brand name' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'strength', label: 'Strength' },
  { key: 'dosage_form', label: 'Dosage form' },
  { key: 'category', label: 'Category' },
  { key: 'pack_size', label: 'Pack size' },
  { key: 'nafdac_number', label: 'NAFDAC / NRN' },
  { key: 'atc_code', label: 'ATC code' },
  { key: 'requires_prescription', label: 'Prescription status' },
]

function humanize(value: string) {
  return value.replace(/^unresolved:/, '').replaceAll('_', ' ')
}

function draftFor(row: ReviewRow): EditDraft {
  const proposal = row.proposal
  return {
    generic_name: proposal.generic_name || '',
    brand_name: proposal.brand_name || '',
    manufacturer: proposal.manufacturer || '',
    strength: proposal.strength || '',
    dosage_form: proposal.dosage_form || '',
    category: proposal.category || '',
    pack_size: proposal.pack_size || '',
    nafdac_number: proposal.nafdac_number || '',
    atc_code: proposal.atc_code || '',
    requires_prescription: proposal.requires_prescription === null
      ? 'unknown'
      : String(proposal.requires_prescription) as 'true' | 'false',
    resolution_action: proposal.resolution_action || '',
    target_product_id: proposal.target_product_id || '',
  }
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Prescription required' : 'OTC / not marked POM'
  return String(value)
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.error || fallback
}

export default function CatalogueReviewClient() {
  const [payload, setPayload] = useState<QueuePayload>({
    counts: {}, total: 0, rows: [], dosage_forms: [], categories: [],
  })
  const [bucket, setBucket] = useState<QueueType>('existing_identity_enrichment')
  const [status, setStatus] = useState<DecisionStatus | 'all'>('pending')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReviewRow | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [notes, setNotes] = useState('')
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [resolvedReasons, setResolvedReasons] = useState<string[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<CatalogueProduct[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const loadSequence = useRef(0)

  const loadQueue = useCallback(async () => {
    const requestSequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      bucket,
      status,
      page: String(page),
      limit: String(PAGE_SIZE),
    })
    if (search) params.set('search', search)
    try {
      const response = await fetch(`/api/admin/catalogue-review?${params}`, {
        cache: 'no-store', credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Could not load catalogue review.'))
      const nextPayload = await response.json()
      if (requestSequence === loadSequence.current) setPayload(nextPayload)
    } catch (loadError) {
      if (requestSequence === loadSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load catalogue review.')
      }
    } finally {
      if (requestSequence === loadSequence.current) setLoading(false)
    }
  }, [bucket, page, search, status])

  useEffect(() => { void loadQueue() }, [loadQueue])

  const openEditor = (row: ReviewRow) => {
    setEditing(row)
    setDraft(draftFor(row))
    setNotes(row.decision_notes || '')
    setResolutionSummary(row.resolution_evidence?.summary || '')
    setResolvedReasons(row.resolved_conflict_reasons || [])
    setProductQuery('')
    setProductResults([])
  }

  const closeEditor = () => {
    setEditing(null)
    setDraft(null)
    setNotes('')
    setResolutionSummary('')
    setResolvedReasons([])
    setProductResults([])
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchText.trim())
  }

  const sendDecision = async (
    row: ReviewRow,
    decision: DecisionStatus,
    includeEdit: boolean,
  ) => {
    if (processing) return
    setProcessing(`${row.id}:${decision}`)
    try {
      const editPayload = includeEdit && draft ? {
        generic_name: draft.generic_name,
        brand_name: draft.brand_name || null,
        manufacturer: draft.manufacturer || null,
        strength: draft.strength,
        dosage_form: draft.dosage_form,
        category: draft.category || null,
        pack_size: draft.pack_size || null,
        nafdac_number: draft.nafdac_number,
        atc_code: draft.atc_code || null,
        requires_prescription: draft.requires_prescription === 'unknown'
          ? null
          : draft.requires_prescription === 'true',
      } : undefined
      const response = await fetch(`/api/admin/catalogue-review/${row.id}/decision`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_status: decision,
          edit: editPayload,
          resolved_conflict_reasons: includeEdit ? resolvedReasons : undefined,
          resolution_evidence: includeEdit ? { summary: resolutionSummary.trim() } : undefined,
          notes: includeEdit ? notes.trim() || null : null,
          resolution_action: includeEdit ? draft?.resolution_action || null : undefined,
          target_product_id: includeEdit ? draft?.target_product_id || null : undefined,
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Could not save the catalogue decision.'))
      toast.success(decision === 'pending' ? 'Review edits saved.' : `Candidate marked ${decision}.`)
      closeEditor()
      await loadQueue()
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : 'Could not save the catalogue decision.')
    } finally {
      setProcessing(null)
    }
  }

  const promote = async (row: ReviewRow) => {
    if (processing) return
    setProcessing(`${row.id}:promote`)
    try {
      const response = await fetch(`/api/admin/catalogue-review/${row.id}/promote`, {
        method: 'POST', credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Could not promote this candidate.'))
      const result = await response.json()
      toast.success(result.idempotent_noop
        ? 'This candidate was already promoted; no duplicate was created.'
        : `Catalogue ${result.promotion_action === 'insert' ? 'product created' : 'product enriched'}.`)
      await loadQueue()
    } catch (promotionError) {
      toast.error(promotionError instanceof Error ? promotionError.message : 'Could not promote this candidate.')
    } finally {
      setProcessing(null)
    }
  }

  const searchProducts = async () => {
    if (productQuery.trim().length < 2) return
    setProductSearching(true)
    try {
      const response = await fetch(
        `/api/admin/catalogue-review/products?q=${encodeURIComponent(productQuery.trim())}`,
        { cache: 'no-store', credentials: 'same-origin' },
      )
      if (!response.ok) throw new Error(await responseError(response, 'Catalogue search failed.'))
      const result = await response.json()
      setProductResults(Array.isArray(result.products) ? result.products : [])
    } catch (searchError) {
      toast.error(searchError instanceof Error ? searchError.message : 'Catalogue search failed.')
    } finally {
      setProductSearching(false)
    }
  }

  const selectProduct = (product: CatalogueProduct) => {
    setDraft((current) => current ? {
      ...current,
      resolution_action: 'existing_enrichment',
      target_product_id: product.id,
    } : current)
    setProductResults([product])
  }

  const resolvableReasons = useMemo(() => {
    if (!editing) return []
    return editing.conflict_reasons.filter((reason) =>
      !ignoredConflictReasons.has(reason) && !immutableConflictReasons.has(reason))
  }, [editing])

  const editorCanApprove = useMemo(() => {
    if (!editing || !draft) return false
    const requiredComplete = Boolean(
      draft.generic_name.trim()
      && draft.strength.trim()
      && draft.dosage_form.trim()
      && draft.nafdac_number.trim(),
    )
    const formSupported = payload.dosage_forms.includes(draft.dosage_form)
    const categorySupported = !draft.category || payload.categories.includes(draft.category)
    const actionComplete = Boolean(
      draft.resolution_action
      && (draft.resolution_action !== 'existing_enrichment' || draft.target_product_id),
    )
    const hasImmutableBlocker = editing.approval_blockers.some((blocker) =>
      immutableBlockers.has(blocker),
    )
    const conflictsResolved = resolvableReasons.every((reason) => resolvedReasons.includes(reason))
    const needsEvidence = editing.queue_type === 'ambiguous_conflicting_match'
      || resolvedReasons.length > 0
    return requiredComplete && formSupported && categorySupported && actionComplete
      && !hasImmutableBlocker && conflictsResolved
      && (!needsEvidence || Boolean(resolutionSummary.trim()))
  }, [draft, editing, payload.categories, payload.dosage_forms, resolvableReasons, resolutionSummary, resolvedReasons])

  const lastPage = Math.max(1, Math.ceil(payload.total / PAGE_SIZE))

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-2 border-b border-border pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Catalogue evidence review</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
              Decide immutable NAFDAC evidence first. Approval records a decision only;
              catalogue promotion remains a separate explicit action.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/catalogue-review/submissions"
              className="inline-flex h-10 items-center justify-center rounded-button border-[1.5px] border-primary bg-white px-5 py-2 text-sm font-bold text-primary shadow-sm transition hover:bg-primary/5"
            >
              Pharmacy submissions
            </Link>
            <Button variant="outline" onClick={() => void loadQueue()} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
        <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <ShieldAlert className="mr-2 inline h-4 w-4" />
          Ingredient, strength, dosage form and NAFDAC/NRN are mandatory. Inactive,
          alert-held and non-medicine records cannot be approved.
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Reconciliation buckets">
        {buckets.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => { setBucket(item.key); setPage(1); closeEditor() }}
            className={`rounded-card border p-4 text-left transition ${item.tone} ${
              bucket === item.key ? 'ring-2 ring-primary ring-offset-2' : 'hover:border-primary/40'
            }`}
          >
            <span className="block text-sm font-semibold text-ink">{item.label}</span>
            <span className="mt-1 block text-2xl font-bold text-ink">{payload.counts[item.key] ?? 0}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-white p-4 md:flex-row md:items-end">
        <form className="flex flex-1 gap-2" onSubmit={submitSearch}>
          <div className="flex-1">
            <Label htmlFor="catalogue-review-search" className="sr-only">Search review queue</Label>
            <Input
              id="catalogue-review-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search product, ingredient, NRN, manufacturer…"
            />
          </div>
          <Button type="submit" variant="outline" className="gap-2"><Search className="h-4 w-4" /> Search</Button>
        </form>
        <div className="w-full md:w-48">
          <Label htmlFor="catalogue-decision-filter" className="text-xs">Decision status</Label>
          <Select
            id="catalogue-decision-filter"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as DecisionStatus | 'all')
              setPage(1)
              closeEditor()
            }}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="held">Held</option>
            <option value="rejected">Rejected</option>
            <option value="all">All decisions</option>
          </Select>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin text-primary" /> Loading evidence queue…
        </div>
      ) : error ? (
        <div className="rounded-card border border-danger/20 bg-danger/5 p-6 text-sm text-danger" role="alert">
          <AlertTriangle className="mb-2 h-6 w-6" />{error}
        </div>
      ) : payload.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-sm text-ink-muted">
          No records match this review filter.
        </div>
      ) : (
        <div className="space-y-4">
          {payload.rows.map((row) => {
            const changed = row.existing_product
              ? diffFields.filter(({ key }) => displayValue(row.existing_product?.[key as keyof CatalogueProduct])
                !== displayValue(row.proposal[key]))
              : []
            const isEditing = editing?.id === row.id && draft
            return (
              <article
                key={row.id}
                data-queue-id={row.id}
                data-queue-type={row.queue_type}
                className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-muted">
                        {humanize(row.queue_type)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.decision_status === 'approved' ? 'bg-emerald-100 text-emerald-800'
                          : row.decision_status === 'rejected' ? 'bg-red-100 text-red-800'
                            : row.decision_status === 'held' ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                      }`}>{row.decision_status}</span>
                      {row.promotion && (
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">
                          promoted: {row.promotion.action}
                        </span>
                      )}
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-ink">
                        {row.proposal.brand_name || row.proposal.generic_name || 'Unnamed source record'}
                      </h2>
                      <p className="text-sm text-ink-muted">{row.proposal.generic_name || 'Ingredient missing'}</p>
                    </div>
                    <dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Strength</dt><dd>{displayValue(row.proposal.strength)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Form</dt><dd>{displayValue(row.proposal.dosage_form)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Manufacturer</dt><dd>{displayValue(row.proposal.manufacturer)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">NAFDAC / NRN</dt><dd>{displayValue(row.proposal.nafdac_number)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Route</dt><dd>{displayValue(row.source.route)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Applicant</dt><dd>{displayValue(row.source.applicant)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Pack</dt><dd>{displayValue(row.proposal.pack_size)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase text-ink-light">Source status</dt><dd>{displayValue(row.source.status)}</dd></div>
                    </dl>

                    {row.source.components.length > 0 && (
                      <div className="rounded-lg bg-surface p-3 text-xs text-ink-muted">
                        <span className="font-semibold text-ink">Ingredient-strength pairs: </span>
                        {row.source.components.map((component) =>
                          `${component.ingredient_raw || '?'} ${component.strength_raw || '?'}`).join(' + ')}
                      </div>
                    )}

                    {(row.conflict_reasons.length > 0 || row.approval_blockers.length > 0) && (
                      <div className="flex flex-wrap gap-2">
                        {row.approval_blockers.map((blocker) => (
                          <span key={blocker} className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-800">
                            {humanize(blocker)}
                          </span>
                        ))}
                      </div>
                    )}

                    {row.existing_product && (
                      <details className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" open>
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                          Existing product diff ({changed.length} changed fields)
                        </summary>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full min-w-[560px] text-left text-xs">
                            <thead><tr className="text-ink-light"><th className="pb-2">Field</th><th className="pb-2">Current</th><th className="pb-2">Proposed</th></tr></thead>
                            <tbody>
                              {diffFields.map(({ key, label }) => {
                                const before = row.existing_product?.[key as keyof CatalogueProduct]
                                const after = row.proposal[key]
                                const differs = displayValue(before) !== displayValue(after)
                                return (
                                  <tr key={key} className={differs ? 'bg-white/70 font-medium' : 'text-ink-muted'}>
                                    <td className="border-t border-emerald-100 py-2 pr-3">{label}</td>
                                    <td className="border-t border-emerald-100 py-2 pr-3">{displayValue(before)}</td>
                                    <td className="border-t border-emerald-100 py-2">{displayValue(after)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}

                    <details className="text-xs text-ink-muted">
                      <summary className="cursor-pointer font-semibold text-ink">Evidence and provenance</summary>
                      <div className="mt-2 space-y-2 rounded-lg bg-surface p-3">
                        <p>Record: {row.record_id} · basis: {row.match_basis || 'manual review'}</p>
                        {row.source.url && (
                          <a href={row.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                            Open source evidence <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <p>Quality flags: {row.source.quality_flags.length ? row.source.quality_flags.join(', ') : 'none recorded'}</p>
                      </div>
                    </details>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 lg:w-48 lg:flex-col">
                    {row.decision_status === 'pending' && (
                      <>
                        <Button
                          disabled={processing !== null || !row.can_quick_approve}
                          onClick={() => void sendDecision(row, 'approved', false)}
                          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          {processing === `${row.id}:approved` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Quick approve
                        </Button>
                        <Button variant="outline" onClick={() => openEditor(row)} disabled={processing !== null} className="gap-2">
                          <PencilLine className="h-4 w-4" /> Edit / resolve
                        </Button>
                      </>
                    )}
                    {row.decision_status === 'approved' && !row.promotion && (
                      <Button onClick={() => void promote(row)} disabled={processing !== null} className="gap-2 bg-violet-700 text-white hover:bg-violet-800">
                        {processing === `${row.id}:promote` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                        Promote to catalogue
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => openEditor(row)} disabled={processing !== null} className="gap-2">
                      <FileCheck2 className="h-4 w-4" /> Review details
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-5 space-y-5 border-t border-border pt-5">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {([
                        ['generic_name', 'Ingredient / generic name'],
                        ['brand_name', 'Product / brand name'],
                        ['manufacturer', 'Manufacturer'],
                        ['strength', 'Strength'],
                        ['pack_size', 'Pack size'],
                        ['nafdac_number', 'NAFDAC / NRN'],
                        ['atc_code', 'ATC code'],
                      ] as Array<[keyof EditDraft, string]>).map(([key, label]) => (
                        <div key={key}>
                          <Label htmlFor={`${row.id}-${key}`} className="text-xs">{label}</Label>
                          <Input
                            id={`${row.id}-${key}`}
                            value={String(draft[key] || '')}
                            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                          />
                        </div>
                      ))}
                      <div>
                        <Label htmlFor={`${row.id}-dosage_form`} className="text-xs">Dosage form</Label>
                        <Select id={`${row.id}-dosage_form`} value={draft.dosage_form} onChange={(event) => setDraft({ ...draft, dosage_form: event.target.value })}>
                          <option value="">Select form</option>
                          {payload.dosage_forms.map((form) => <option key={form} value={form}>{form}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`${row.id}-category`} className="text-xs">Category</Label>
                        <Select id={`${row.id}-category`} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                          <option value="">No category</option>
                          {payload.categories.map((category) => <option key={category} value={category}>{category}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`${row.id}-rx`} className="text-xs">Prescription status</Label>
                        <Select id={`${row.id}-rx`} value={draft.requires_prescription} onChange={(event) => setDraft({ ...draft, requires_prescription: event.target.value as EditDraft['requires_prescription'] })}>
                          <option value="unknown">Unresolved (promotion defaults safely to POM)</option>
                          <option value="true">Prescription required</option>
                          <option value="false">OTC / not marked POM</option>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`${row.id}-resolution-action`} className="text-xs">Resolution</Label>
                        <Select
                          id={`${row.id}-resolution-action`}
                          value={draft.resolution_action}
                          onChange={(event) => setDraft({
                            ...draft,
                            resolution_action: event.target.value as EditDraft['resolution_action'],
                            target_product_id: event.target.value === 'new_identity' ? '' : draft.target_product_id,
                          })}
                        >
                          <option value="">Select resolution</option>
                          <option value="new_identity">Create a distinct product</option>
                          <option value="existing_enrichment">Enrich an existing product</option>
                        </Select>
                      </div>
                    </div>

                    {draft.resolution_action === 'existing_enrichment' && (
                      <div className="rounded-lg border border-border bg-surface p-4">
                        <Label htmlFor={`${row.id}-product-search`} className="text-xs">Catalogue target</Label>
                        <div className="mt-1 flex gap-2">
                          <Input id={`${row.id}-product-search`} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search generic, brand or NRN" />
                          <Button type="button" variant="outline" onClick={() => void searchProducts()} disabled={productSearching || productQuery.trim().length < 2}>
                            {productSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </Button>
                        </div>
                        {draft.target_product_id && <p className="mt-2 text-xs font-semibold text-emerald-800">Selected product: {draft.target_product_id}</p>}
                        {productResults.length > 0 && (
                          <div className="mt-3 grid gap-2">
                            {productResults.map((product) => (
                              <button key={product.id} type="button" onClick={() => selectProduct(product)} className="rounded-lg border border-border bg-white p-3 text-left text-xs hover:border-primary">
                                <span className="font-semibold text-ink">{product.brand_name || product.generic_name}</span>
                                <span className="ml-2 text-ink-muted">{product.generic_name} · {product.strength} · {product.dosage_form || 'form missing'} · {product.nafdac_number || 'NRN missing'}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {resolvableReasons.length > 0 && (
                      <fieldset className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <legend className="px-1 text-sm font-semibold text-amber-900">Explicit conflict resolution</legend>
                        <p className="mb-3 text-xs text-amber-900">Check only reasons resolved by the evidence you record below.</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {resolvableReasons.map((reason) => (
                            <label key={reason} className="flex items-center gap-2 text-xs text-ink">
                              <Checkbox checked={resolvedReasons.includes(reason)} onCheckedChange={(checked) => setResolvedReasons((current) => checked ? [...new Set([...current, reason])] : current.filter((item) => item !== reason))} />
                              {humanize(reason)}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor={`${row.id}-evidence`} className="text-xs">Resolution evidence</Label>
                        <Textarea id={`${row.id}-evidence`} value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} placeholder="Source URL, document and reasoning supporting each resolved conflict" />
                      </div>
                      <div>
                        <Label htmlFor={`${row.id}-notes`} className="text-xs">Decision reason / notes</Label>
                        <Textarea id={`${row.id}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Required for Hold or Reject" />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => void sendDecision(row, 'pending', true)} disabled={processing !== null} className="gap-2">
                        <PencilLine className="h-4 w-4" /> Save edits
                      </Button>
                      <Button type="button" onClick={() => void sendDecision(row, 'approved', true)} disabled={processing !== null || !editorCanApprove} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> Save and approve
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void sendDecision(row, 'held', true)} disabled={processing !== null || !notes.trim()} className="gap-2 border-amber-300 text-amber-800">
                        <ShieldAlert className="h-4 w-4" /> Hold
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void sendDecision(row, 'rejected', true)} disabled={processing !== null || !notes.trim()} className="gap-2 border-danger/30 text-danger">
                        <XCircle className="h-4 w-4" /> Reject
                      </Button>
                      <Button type="button" variant="ghost" onClick={closeEditor} disabled={processing !== null}>Cancel</Button>
                    </div>
                    {!editorCanApprove && (
                      <p className="text-xs text-amber-800">
                        Approval remains locked until identity fields, supported form/category,
                        resolution action and required conflict evidence are complete.
                      </p>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-border pt-4 text-sm text-ink-muted">
        <span>{payload.total.toLocaleString()} records · page {page} of {lastPage}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= lastPage || loading} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </footer>
    </div>
  )
}
