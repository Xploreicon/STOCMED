'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { EnrichedInventoryRow } from '@/lib/pharmacyInventory';

interface EditDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: EnrichedInventoryRow;
  onSuccess: () => void;
}

const inputClass =
  'h-12 w-full rounded-control border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40';
const labelClass = 'mb-2 block text-sm font-medium text-ink';

export default function EditDrugModal({ isOpen, onClose, row, onSuccess }: EditDrugModalProps) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState('');
  const [threshold, setThreshold] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setPrice(String(row.price ?? ''));
      setThreshold(String(row.low_stock_threshold ?? ''));
      setNotes(row.notes ?? '');
      setError(null);
    }
  }, [row]);

  const editMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/pharmacy/drugs/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: parseFloat(price),
          low_stock_threshold: parseInt(threshold, 10),
          notes: notes || null,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update medication');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
      onSuccess();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await editMutation.mutateAsync();
    } catch (err: any) {
      setError(err.message || 'Failed to update medication');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-[480px] overflow-y-auto rounded-feature p-7">
        <form onSubmit={handleSubmit}>
          <div className="mb-5 flex items-center justify-between">
            <DialogTitle className="text-xl font-medium text-ink">Edit medication</DialogTitle>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-5 text-sm text-secondary">
            {row.generic_name} {row.brand_name ? `· ${row.brand_name}` : ''}
          </div>
          <div className="flex flex-col gap-[18px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Price (₦)</label>
                <input
                  type="number"
                  className={inputClass}
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Low stock threshold</label>
                <input
                  type="number"
                  className={inputClass}
                  placeholder="10"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Notes (optional)</label>
              <input
                className={inputClass}
                placeholder="e.g. Requires cold storage"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-stock-out">{error}</p>}
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={editMutation.isPending}
                className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editMutation.isPending}
                className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white disabled:opacity-60"
              >
                {editMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
