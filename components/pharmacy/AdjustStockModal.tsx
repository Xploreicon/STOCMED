'use client';

import { Button } from '@/components/ui/button'

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { EnrichedInventoryRow } from '@/lib/pharmacyInventory';
import type { MovementUiType } from '@/lib/pharmacyInventory';
import { formatExpiry } from '@/lib/inventoryUi';

interface AdjustStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: EnrichedInventoryRow;
  onSuccess: () => void;
}

const movementTypes: MovementUiType[] = ['Restock', 'Adjustment', 'Return', 'Write-off', 'Expiry'];

const inputClass =
  'h-12 w-full rounded-control border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40';
const labelClass = 'mb-2 block text-sm font-medium text-ink';

export default function AdjustStockModal({ isOpen, onClose, row, onSuccess }: AdjustStockModalProps) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<MovementUiType>('Restock');
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/pharmacy/drugs/${row.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          batch_id: batchId || null,
          quantity: parseFloat(quantity),
          reason,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save stock movement');
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
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    if (!quantity || Number(quantity) === 0) {
      setError('Enter a non-zero quantity');
      return;
    }
    try {
      await adjustMutation.mutateAsync();
    } catch (err: any) {
      setError(err.message || 'Failed to save stock movement');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[400px] rounded-feature p-7">
        <form onSubmit={handleSubmit}>
          <div className="mb-5 flex items-center justify-between">
            <DialogTitle className="text-xl font-medium text-ink">Adjust stock</DialogTitle>
            <Button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mb-5 text-sm text-secondary">
            {row.generic_name} &mdash; current qty {row.quantity_in_stock}
          </p>
          <div className="flex flex-col gap-[18px]">
            <div>
              <label className={labelClass}>Movement type</label>
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as MovementUiType)}>
                {movementTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Batch</label>
              <select className={inputClass} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">No specific batch</option>
                {row.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Batch {b.batch_number} · qty {b.remaining_qty} · exp {formatExpiry(b.expiry_date)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Quantity</label>
              <input
                type="number"
                className={inputClass}
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>
                Reason <span className="text-stock-out">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="Required — e.g. Delivery from distributor"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="mt-3 text-xs text-stock-out">{error}</p>}
          <p className="mt-3.5 text-xs text-muted">Every change is recorded — full stock history is kept.</p>
          <div className="mt-5 flex gap-3">
            <Button
              type="button"
              onClick={onClose}
              disabled={adjustMutation.isPending}
              className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={adjustMutation.isPending}
              className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white disabled:opacity-60"
            >
              {adjustMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
