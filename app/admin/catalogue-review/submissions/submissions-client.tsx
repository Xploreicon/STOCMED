'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, PencilLine, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Product = {
  id: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  strength: string
  dosage_form: string | null
  category: string | null
  pack_size: string | null
  nafdac_number: string | null
  barcode: string | null
  requires_prescription: boolean
  created_at: string
}

type Draft = Omit<Product, 'id' | 'created_at'>
type Payload = { products: Product[]; total: number; page: number; limit: number; dosage_forms: string[]; categories: string[] }

const emptyPayload: Payload = { products: [], total: 0, page: 1, limit: 25, dosage_forms: [], categories: [] }

function draftFor(product: Product): Draft {
  return {
    generic_name: product.generic_name,
    brand_name: product.brand_name,
    manufacturer: product.manufacturer,
    strength: product.strength,
    dosage_form: product.dosage_form,
    category: product.category,
    pack_size: product.pack_size,
    nafdac_number: product.nafdac_number,
    barcode: product.barcode,
    requires_prescription: product.requires_prescription,
  }
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.error || fallback
}

export default function CatalogueSubmissionsClient() {
  const [payload, setPayload] = useState<Payload>(emptyPayload)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notes, setNotes] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), limit: '25' })
    if (search) params.set('q', search)
    try {
      const response = await fetch(`/api/admin/catalogue-review/submissions?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await responseError(response, 'Could not load pharmacy submissions.'))
      setPayload(await response.json())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load pharmacy submissions.')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { void load() }, [load])

  const openEditor = (product: Product) => {
    setEditing(product)
    setDraft(draftFor(product))
    setNotes('')
  }

  const closeEditor = () => {
    setEditing(null)
    setDraft(null)
    setNotes('')
  }

  const act = async (action: 'edit' | 'verify' | 'reject') => {
    if (!editing || !draft || processing) return
    setProcessing(action)
    try {
      const response = await fetch(`/api/admin/catalogue-review/submissions/${editing.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, edit: action === 'reject' ? undefined : draft, notes: notes.trim() || null }),
      })
      if (!response.ok) throw new Error(await responseError(response, `Could not ${action} this product.`))
      toast.success(action === 'verify' ? 'Product verified and unlocked for catalogue linking.' : action === 'edit' ? 'Product details saved.' : 'Product rejected.')
      closeEditor()
      await load()
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : `Could not ${action} this product.`)
    } finally {
      setProcessing(null)
    }
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchText.trim())
  }

  const lastPage = Math.max(1, Math.ceil(payload.total / payload.limit))

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-3 border-b border-border pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Pharmacy catalogue submissions ({payload.total})</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
              Correct identity details before verification. Only verified products become available for Store→Medicine linking.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/catalogue-review"
              className="inline-flex h-10 items-center justify-center rounded-button border-[1.5px] border-primary bg-white px-5 py-2 text-sm font-bold text-primary shadow-sm transition hover:bg-primary/5"
            >
              Evidence queue
            </Link>
            <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
        <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Verification requires an ingredient/name, strength, dosage form and NAFDAC/NRN. The original pharmacy inventory remains untouched during review.
        </div>
      </header>

      <form onSubmit={submitSearch} className="flex gap-2 rounded-card border border-border bg-white p-4">
        <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search name, brand, or NAFDAC/NRN" />
        <Button type="submit" variant="outline" className="gap-2"><Search className="h-4 w-4" />Search</Button>
      </form>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" />Loading submissions…</div>
      ) : error ? (
        <div role="alert" className="rounded-card border border-danger/20 bg-danger/5 p-5 text-sm text-danger"><AlertTriangle className="mb-2 h-5 w-5" />{error}</div>
      ) : payload.products.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-sm text-ink-muted">No unverified pharmacy submissions match this view.</div>
      ) : (
        <div className="grid gap-4">
          {payload.products.map((product) => (
            <article key={product.id} className="rounded-card border border-border bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-ink">{product.brand_name || product.generic_name}</h2>
                  <p className="mt-1 text-sm text-ink-muted">{product.generic_name} · {product.strength || 'strength missing'} · {product.dosage_form || 'form missing'}</p>
                  <p className="mt-1 text-xs text-ink-light">NAFDAC/NRN: {product.nafdac_number || 'missing'} · Submitted {new Date(product.created_at).toLocaleDateString('en-NG')}</p>
                </div>
                <Button variant="outline" onClick={() => openEditor(product)} className="gap-2"><PencilLine className="h-4 w-4" />Edit and review</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="gap-2"><ChevronLeft className="h-4 w-4" />Previous</Button>
        <span className="text-xs text-ink-muted">Page {page} of {lastPage}</span>
        <Button variant="outline" disabled={page >= lastPage || loading} onClick={() => setPage((value) => value + 1)} className="gap-2">Next<ChevronRight className="h-4 w-4" /></Button>
      </div>

      {editing && draft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit catalogue submission">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-card bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-ink">Edit and review {editing.brand_name || editing.generic_name}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Ingredient / generic" value={draft.generic_name} onChange={(value) => setDraft({ ...draft, generic_name: value })} required />
              <Field label="Brand name" value={draft.brand_name || ''} onChange={(value) => setDraft({ ...draft, brand_name: value || null })} />
              <Field label="Manufacturer" value={draft.manufacturer || ''} onChange={(value) => setDraft({ ...draft, manufacturer: value || null })} />
              <Field label="Strength" value={draft.strength} onChange={(value) => setDraft({ ...draft, strength: value })} required />
              <label className="text-sm font-medium text-ink">Dosage form *<Select className="mt-2" value={draft.dosage_form || ''} onChange={(event) => setDraft({ ...draft, dosage_form: event.target.value || null })}><option value="">Select dosage form</option>{payload.dosage_forms.map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
              <label className="text-sm font-medium text-ink">Category<Select className="mt-2" value={draft.category || ''} onChange={(event) => setDraft({ ...draft, category: event.target.value || null })}><option value="">No category</option>{payload.categories.map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
              <Field label="Pack size" value={draft.pack_size || ''} onChange={(value) => setDraft({ ...draft, pack_size: value || null })} />
              <Field label="NAFDAC / NRN" value={draft.nafdac_number || ''} onChange={(value) => setDraft({ ...draft, nafdac_number: value || null })} required />
              <Field label="Barcode" value={draft.barcode || ''} onChange={(value) => setDraft({ ...draft, barcode: value || null })} />
              <label className="flex items-center gap-2 self-end rounded-button border border-border px-3 py-2 text-sm"><input type="checkbox" checked={draft.requires_prescription} onChange={(event) => setDraft({ ...draft, requires_prescription: event.target.checked })} />Prescription required</label>
            </div>
            <div className="mt-4"><Label htmlFor="submission-notes">Review notes / rejection reason</Label><Textarea id="submission-notes" className="mt-2" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={processing !== null} onClick={closeEditor}>Cancel</Button>
              <Button variant="outline" disabled={processing !== null} onClick={() => void act('edit')} className="gap-2">{processing === 'edit' && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</Button>
              <Button variant="outline" disabled={processing !== null || !notes.trim()} onClick={() => void act('reject')} className="gap-2 border-danger/30 text-danger"><XCircle className="h-4 w-4" />Reject</Button>
              <Button disabled={processing !== null || !draft.generic_name.trim() || !draft.strength.trim() || !draft.dosage_form || !draft.nafdac_number?.trim()} onClick={() => void act('verify')} className="gap-2 bg-success text-white hover:bg-success/90"><ShieldCheck className="h-4 w-4" />Verify product</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="text-sm font-medium text-ink">{label}{required ? ' *' : ''}<Input className="mt-2" value={value} onChange={(event) => onChange(event.target.value)} /></label>
}
