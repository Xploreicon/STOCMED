'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Barcode, Loader2, PackagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface AddStoreItemModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const categories = [
  'Personal care',
  'Baby care',
  'Food & beverages',
  'Household',
  'Medical supplies',
  'Cosmetics',
  'Airtime/Other',
]

const initialForm = {
  item_name: '',
  brand: '',
  barcode: '',
  store_category: 'Airtime/Other',
  unit_description: '',
  price: '',
  unit_cost: '',
  quantity_in_stock: '',
  low_stock_threshold: '10',
  tracks_expiry: false,
  batch_number: '',
  expiry_date: '',
}

export default function AddStoreItemModal({
  isOpen,
  onClose,
  onSuccess,
}: AddStoreItemModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initialForm)

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pharmacy/drugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          item_type: 'store',
          price: Number(form.price),
          unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
          quantity_in_stock: Number(form.quantity_in_stock),
          low_stock_threshold: Number(form.low_stock_threshold),
          batch_number: form.tracks_expiry ? form.batch_number : null,
          expiry_date: form.tracks_expiry ? form.expiry_date : null,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to add store item')
      return payload
    },
    onSuccess: () => {
      setForm(initialForm)
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' })
      onSuccess()
    },
  })

  const update = (name: string, value: string | boolean) => {
    setForm((current) => ({ ...current, [name]: value }))
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border p-0 shadow-2xl">
        <DialogHeader className="border-b border-border bg-primary/5 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl text-ink">
            <PackagePlus className="h-5 w-5 text-primary" />
            Add store item
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5 p-6"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-medium text-ink">
              Item name
              <Input required value={form.item_name} onChange={(e) => update('item_name', e.target.value)} className="mt-1.5" placeholder="e.g. Dettol Antiseptic 500ml" />
            </label>
            <label className="text-sm font-medium text-ink">
              Brand
              <Input value={form.brand} onChange={(e) => update('brand', e.target.value)} className="mt-1.5" />
            </label>
            <label className="text-sm font-medium text-ink">
              Barcode
              <div className="relative mt-1.5">
                <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-light" />
                <Input value={form.barcode} onChange={(e) => update('barcode', e.target.value)} className="pl-9" inputMode="numeric" />
              </div>
            </label>
            <label className="text-sm font-medium text-ink">
              Category
              <select value={form.store_category} onChange={(e) => update('store_category', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink">
              Unit / pack
              <Input value={form.unit_description} onChange={(e) => update('unit_description', e.target.value)} className="mt-1.5" placeholder="e.g. 500ml bottle" />
            </label>
            <label className="text-sm font-medium text-ink">
              Selling price
              <Input required min="0.01" step="0.01" type="number" value={form.price} onChange={(e) => update('price', e.target.value)} className="mt-1.5" />
            </label>
            <label className="text-sm font-medium text-ink">
              Unit cost
              <Input min="0" step="0.01" type="number" value={form.unit_cost} onChange={(e) => update('unit_cost', e.target.value)} className="mt-1.5" />
            </label>
            <label className="text-sm font-medium text-ink">
              Opening quantity
              <Input required min="0" step="1" type="number" value={form.quantity_in_stock} onChange={(e) => update('quantity_in_stock', e.target.value)} className="mt-1.5" />
            </label>
            <label className="text-sm font-medium text-ink">
              Low-stock alert
              <Input required min="0" step="1" type="number" value={form.low_stock_threshold} onChange={(e) => update('low_stock_threshold', e.target.value)} className="mt-1.5" />
            </label>
          </div>

          <label className="flex items-center justify-between border-y border-border py-3 text-sm font-medium text-ink">
            Track batch and expiry
            <input type="checkbox" checked={form.tracks_expiry} onChange={(e) => update('tracks_expiry', e.target.checked)} className="h-4 w-4 accent-primary" />
          </label>

          {form.tracks_expiry && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-ink">
                Batch number
                <Input required value={form.batch_number} onChange={(e) => update('batch_number', e.target.value)} className="mt-1.5" />
              </label>
              <label className="text-sm font-medium text-ink">
                Expiry date
                <Input required type="date" value={form.expiry_date} onChange={(e) => update('expiry_date', e.target.value)} className="mt-1.5" />
              </label>
            </div>
          )}

          {mutation.error && (
            <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              {mutation.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} className="bg-primary text-white hover:bg-[var(--primary-hover)]">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add to store
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
