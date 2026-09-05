'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { withStaffSessionHeader } from '@/lib/staff-session-client'
import { toast } from 'sonner'

type CatalogueProduct = {
  id: string
  generic_name: string
  brand_name: string | null
  strength: string
  dosage_form: string | null
  pack_size: string | null
  manufacturer: string | null
}

interface StoreMedicinePromotionProps {
  inventoryId: string
  initialQuery: string
  disabled?: boolean
  onPromoted: () => void
}

function productName(product: CatalogueProduct) {
  return product.brand_name
    ? `${product.brand_name} (${product.generic_name})`
    : product.generic_name
}

export function StoreMedicinePromotion({
  inventoryId,
  initialQuery,
  disabled = false,
  onPromoted,
}: StoreMedicinePromotionProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<CatalogueProduct[]>([])
  const [selected, setSelected] = useState<CatalogueProduct | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isPromoting, setIsPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setQuery(initialQuery)
    setResults([])
    setSelected(null)
    setError(null)
    setIsSearching(false)
    setIsPromoting(false)
  }, [initialQuery, inventoryId])

  useEffect(() => {
    const search = query.trim()
    if (search.length < 2) {
      setResults([])
      setIsSearching(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setIsSearching(true)
      setError(null)
      try {
        const response = await fetch(`/api/pharmacy/catalogue?q=${encodeURIComponent(search)}`, {
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not search the catalogue')
        setResults(Array.isArray(payload.products) ? payload.products : [])
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === 'AbortError') return
        setResults([])
        setError(searchError instanceof Error ? searchError.message : 'Could not search the catalogue')
      } finally {
        if (!controller.signal.aborted) setIsSearching(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query])

  const promote = async () => {
    if (!selected) {
      setError('Link a catalogue drug to promote')
      return
    }

    setIsPromoting(true)
    setError(null)
    try {
      const response = await fetch(`/api/pharmacy/drugs/${inventoryId}`, {
        method: 'PATCH',
        headers: withStaffSessionHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ promote_to_product_id: selected.id }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not promote this Store item')
      if (payload.batch_capture_required) {
        toast.warning('Medicine promoted. Add its batch number and expiry date before dispensing.')
      } else {
        toast.success('Store item promoted to Medicine.')
      }
      onPromoted()
    } catch (promotionError) {
      setError(promotionError instanceof Error ? promotionError.message : 'Could not promote this Store item')
    } finally {
      setIsPromoting(false)
    }
  }

  const search = query.trim()

  return (
    <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div>
        <h4 className="text-sm font-semibold text-ink">Promote to Medicine</h4>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          Link this Store item to one catalogue drug. Its medicine name, strength, and dosage form will come from that catalogue record.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-light" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(null)
          }}
          placeholder="Search generic or brand name"
          className="bg-white pl-9"
          disabled={disabled || isPromoting}
          aria-label="Search the medicine catalogue"
        />
      </div>

      {isSearching && (
        <div className="flex items-center gap-2 py-3 text-xs text-ink-muted" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching catalogue…
        </div>
      )}

      {!isSearching && results.length > 0 && (
        <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-white">
          {results.map((product) => {
            const isSelected = selected?.id === product.id
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => {
                  setSelected(product)
                  setError(null)
                }}
                disabled={disabled || isPromoting}
                aria-pressed={isSelected}
                className={`flex w-full items-start justify-between gap-3 p-3 text-left transition-colors ${
                  isSelected ? 'bg-primary/10' : 'hover:bg-surface'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{productName(product)}</span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {product.strength || 'Strength not recorded'} · {product.dosage_form || 'Form not recorded'}
                    {product.manufacturer ? ` · ${product.manufacturer}` : ''}
                  </span>
                </span>
                {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}

      {!isSearching && search.length >= 2 && results.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-border bg-white p-3 text-xs leading-5 text-ink-muted">
          No catalogue drug found. Keep this item in Store and request a catalogue addition; it can be promoted after admin approval.
        </div>
      )}

      {selected && (
        <div className="rounded-md border border-success/20 bg-success/5 p-3 text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">Selected:</span> {productName(selected)} · {selected.strength} · {selected.dosage_form || 'Form not recorded'}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-danger" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="button"
        onClick={() => void promote()}
        disabled={disabled || isPromoting || !selected}
        className="w-full"
      >
        {isPromoting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Promoting…
          </>
        ) : selected ? (
          'Confirm promotion to Medicine'
        ) : (
          'Link a catalogue drug to promote'
        )}
      </Button>
    </section>
  )
}
