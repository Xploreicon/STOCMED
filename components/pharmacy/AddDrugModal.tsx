'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';

interface CatalogueProduct {
  id: string;
  generic_name: string;
  brand_name: string | null;
  strength: string;
  dosage_form: string | null;
  pack_size: string | null;
}

interface AddDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  prefillName?: string;
}

type Step = 'search' | 'new' | 'details';

const categories = [
  'Analgesics',
  'Antibiotics',
  'Antimalarials',
  'Antihypertensives',
  'Diabetes',
  'Vitamins',
  'Gastrointestinal',
  'Respiratory',
  'Others',
];

const dosageForms = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler'];

const inputClass =
  'h-12 w-full rounded-control border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40';
const labelClass = 'mb-2 block text-sm font-medium text-ink';

export default function AddDrugModal({ isOpen, onClose, onSuccess, prefillName }: AddDrugModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('search');
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<CatalogueProduct | null>(null);
  const [newProduct, setNewProduct] = useState({
    generic_name: '',
    brand_name: '',
    strength: '',
    dosage_form: '',
    category: '',
  });
  const [details, setDetails] = useState({
    price: '',
    opening_stock: '',
    batch_number: '',
    expiry_date: '',
    low_stock_threshold: '10',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('search');
      setCatalogueQuery(prefillName ?? '');
      setSelectedProduct(null);
      setNewProduct({ generic_name: prefillName ?? '', brand_name: '', strength: '', dosage_form: '', category: '' });
      setDetails({ price: '', opening_stock: '', batch_number: '', expiry_date: '', low_stock_threshold: '10' });
      setError(null);
    }
  }, [isOpen, prefillName]);

  const { data: catalogueData, isFetching: isSearching } = useQuery({
    queryKey: ['pharmacy-catalogue', catalogueQuery],
    queryFn: async () => {
      const response = await fetch(`/api/pharmacy/catalogue?q=${encodeURIComponent(catalogueQuery)}`);
      if (!response.ok) throw new Error('Failed to search catalogue');
      return response.json();
    },
    enabled: isOpen && step === 'search',
  });

  const addDrugMutation = useMutation({
    mutationFn: async (payload: any) => {
      const response = await fetch('/api/pharmacy/drugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to add medication');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-unmet-demand'], refetchType: 'active' });
      onSuccess();
    },
  });

  const handleSelectProduct = (product: CatalogueProduct) => {
    setSelectedProduct(product);
    setStep('details');
  };

  const handleContinueNewProduct = () => {
    if (!newProduct.generic_name.trim() || !newProduct.strength.trim()) {
      setError('Generic name and strength are required');
      return;
    }
    setError(null);
    setSelectedProduct(null);
    setStep('details');
  };

  const handleSubmitDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!details.price) {
      setError('Price is required');
      return;
    }

    try {
      await addDrugMutation.mutateAsync({
        product_id: selectedProduct?.id,
        new_product: selectedProduct
          ? undefined
          : {
              generic_name: newProduct.generic_name,
              brand_name: newProduct.brand_name || undefined,
              strength: newProduct.strength,
              dosage_form: newProduct.dosage_form || undefined,
              category: newProduct.category || undefined,
            },
        price: parseFloat(details.price),
        opening_stock: details.opening_stock ? parseInt(details.opening_stock, 10) : 0,
        batch_number: details.batch_number || undefined,
        expiry_date: details.expiry_date || undefined,
        low_stock_threshold: details.low_stock_threshold ? parseInt(details.low_stock_threshold, 10) : 10,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to add medication');
    }
  };

  const products: CatalogueProduct[] = catalogueData?.products ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-[480px] overflow-y-auto rounded-feature p-7">
        {step === 'search' && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <DialogTitle className="text-xl font-medium text-ink">Add medication</DialogTitle>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              autoFocus
              value={catalogueQuery}
              onChange={(e) => setCatalogueQuery(e.target.value)}
              placeholder="Search the drug catalogue…"
              className={`${inputClass} mb-4 h-12`}
            />
            <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
              {isSearching && <p className="text-sm text-secondary">Searching…</p>}
              {!isSearching && products.length === 0 && (
                <p className="text-sm text-secondary">No matches in the catalogue yet.</p>
              )}
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProduct(p)}
                  className="rounded-lg border border-hairline px-3.5 py-3 text-left hover:bg-brand-tint"
                >
                  <div className="text-sm font-medium text-ink">
                    {p.generic_name} <span className="font-normal text-muted">· {p.brand_name || 'Generic'}</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-secondary">
                    {p.strength} {p.dosage_form ? `· ${p.dosage_form}` : ''} {p.pack_size ? `· ${p.pack_size}` : ''}
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('new')}
              className="mt-4 block w-full text-center text-[13px] font-medium text-brand"
            >
              Can&apos;t find it? Add a new product to the catalogue.
            </button>
          </>
        )}

        {step === 'new' && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <DialogTitle className="text-xl font-medium text-ink">Add new product to catalogue</DialogTitle>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-[18px]">
              <div>
                <label className={labelClass}>Generic name</label>
                <input
                  className={inputClass}
                  placeholder="e.g. Amoxicillin"
                  value={newProduct.generic_name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, generic_name: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Brand name</label>
                <input
                  className={inputClass}
                  placeholder="e.g. Amoxil"
                  value={newProduct.brand_name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, brand_name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Strength &amp; form</label>
                  <input
                    className={inputClass}
                    placeholder="e.g. 500mg"
                    value={newProduct.strength}
                    onChange={(e) => setNewProduct((p) => ({ ...p, strength: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    className={inputClass}
                    value={newProduct.category}
                    onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Dosage form</label>
                <select
                  className={inputClass}
                  value={newProduct.dosage_form}
                  onChange={(e) => setNewProduct((p) => ({ ...p, dosage_form: e.target.value }))}
                >
                  <option value="">Select form</option>
                  {dosageForms.map((f) => (
                    <option key={f} value={f}>
                      {capitalize(f)}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-xs text-stock-out">{error}</p>}
              <div className="mt-2 flex gap-3">
                <button
                  onClick={() => setStep('search')}
                  className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
                >
                  Back
                </button>
                <button
                  onClick={handleContinueNewProduct}
                  className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white"
                >
                  Continue
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'details' && (
          <form onSubmit={handleSubmitDetails}>
            <div className="mb-5 flex items-center justify-between">
              <DialogTitle className="text-xl font-medium text-ink">Add medication</DialogTitle>
              <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mb-5 rounded-lg border border-hairline bg-brand-tint p-3.5">
              <div className="text-sm font-medium text-ink">
                {selectedProduct ? (
                  <>
                    {selectedProduct.generic_name}{' '}
                    <span className="font-normal text-muted">· {selectedProduct.brand_name || 'Generic'}</span>
                  </>
                ) : (
                  <>
                    {newProduct.generic_name}{' '}
                    {newProduct.brand_name && <span className="font-normal text-muted">· {newProduct.brand_name}</span>}
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[13px] text-secondary">
                {(selectedProduct?.strength || newProduct.strength) ?? ''}{' '}
                {(selectedProduct?.dosage_form || newProduct.dosage_form) &&
                  `· ${selectedProduct?.dosage_form || newProduct.dosage_form}`}
                {selectedProduct?.pack_size ? ` · ${selectedProduct.pack_size}` : ''}
              </div>
              <button
                type="button"
                onClick={() => setStep(selectedProduct ? 'search' : 'new')}
                className="mt-2 inline-block text-xs font-medium text-brand"
              >
                Change product
              </button>
            </div>
            <div className="flex flex-col gap-[18px]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Price (₦)</label>
                  <input
                    type="number"
                    className={inputClass}
                    placeholder="0"
                    value={details.price}
                    onChange={(e) => setDetails((d) => ({ ...d, price: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Opening stock</label>
                  <input
                    type="number"
                    className={inputClass}
                    placeholder="0"
                    value={details.opening_stock}
                    onChange={(e) => setDetails((d) => ({ ...d, opening_stock: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Batch number</label>
                  <input
                    className={inputClass}
                    placeholder="e.g. B24178"
                    value={details.batch_number}
                    onChange={(e) => setDetails((d) => ({ ...d, batch_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expiry date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={details.expiry_date}
                    onChange={(e) => setDetails((d) => ({ ...d, expiry_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Low-stock threshold</label>
                <input
                  type="number"
                  className={inputClass}
                  placeholder="10"
                  value={details.low_stock_threshold}
                  onChange={(e) => setDetails((d) => ({ ...d, low_stock_threshold: e.target.value }))}
                />
              </div>
              {error && <p className="text-xs text-stock-out">{error}</p>}
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={addDrugMutation.isPending}
                  className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addDrugMutation.isPending}
                  className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white disabled:opacity-60"
                >
                  {addDrugMutation.isPending ? 'Adding…' : 'Add medication'}
                </button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
