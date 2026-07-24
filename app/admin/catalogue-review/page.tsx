'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, PackageSearch, Loader2, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ProductRecord = {
  id: string
  generic_name: string
  brand_name: string | null
  manufacturer: string | null
  strength: string | null
  dosage_form: string | null
  category: string | null
  pack_size: string | null
  created_at: string
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return data?.error || fallback
}

export default function CatalogueReviewPage() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/catalogue-review', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(await readError(response, 'Could not load unverified products.'))
      const payload = await response.json()
      setProducts(Array.isArray(payload?.products) ? payload.products : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load unverified products.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])

  const handleAction = async (id: string, action: 'verify' | 'reject') => {
    if (processing) return
    setProcessing(`${id}:${action}`)
    try {
      const response = await fetch(`/api/admin/catalogue-review/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error(await readError(response, `Could not ${action} the product.`))
      
      toast.success(action === 'verify' ? 'Product verified successfully.' : 'Product rejected and removed.')
      await loadProducts()
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : `Could not ${action} the product.`)
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
            Unverified Catalogue Products ({products.length})
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
            Review and verify products submitted by pharmacies. Unverified products will not be generally visible.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadProducts()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          Loading unverified products…
        </div>
      ) : error ? (
        <div className="rounded-card border border-danger/20 bg-danger/5 p-6 text-sm text-danger" role="alert">
          <AlertTriangle className="mb-2 h-6 w-6" aria-hidden="true" />
          {error}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-sm text-ink-muted">
          No unverified products found.
        </div>
      ) : (
        <div className="grid gap-4">
          {products.map((product) => (
            <article key={product.id} className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <PackageSearch className="h-5 w-5 text-primary" aria-hidden="true" />
                    <h2 className="truncate text-base font-semibold text-ink">
                      {product.generic_name} {product.brand_name ? `(${product.brand_name})` : ''}
                    </h2>
                  </div>
                  
                  <div className="mt-2 grid grid-cols-2 gap-y-2 gap-x-4 text-sm text-ink-muted sm:grid-cols-4">
                    {product.strength && (
                      <p><span className="font-semibold text-ink">Strength:</span> {product.strength}</p>
                    )}
                    {product.dosage_form && (
                      <p><span className="font-semibold text-ink">Form:</span> {product.dosage_form}</p>
                    )}
                    {product.category && (
                      <p><span className="font-semibold text-ink">Category:</span> {product.category}</p>
                    )}
                    <p><span className="font-semibold text-ink">Created:</span> {formatDate(product.created_at)}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3 sm:flex-col lg:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={processing !== null}
                    onClick={() => void handleAction(product.id, 'reject')}
                    className="border-danger/30 text-danger hover:bg-danger/10"
                  >
                    {processing === `${product.id}:reject` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Reject
                  </Button>
                  <Button
                    type="button"
                    disabled={processing !== null}
                    onClick={() => void handleAction(product.id, 'verify')}
                    className="bg-success text-white hover:bg-success/90"
                  >
                    {processing === `${product.id}:verify` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Verify
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
