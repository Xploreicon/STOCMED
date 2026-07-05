'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { EnrichedInventoryRow } from '@/lib/pharmacyInventory';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  row: EnrichedInventoryRow;
  onSuccess: () => void;
}

export default function DeleteConfirmDialog({ isOpen, onClose, row, onSuccess }: DeleteConfirmDialogProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/pharmacy/drugs/${row.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete medication');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
      onSuccess();
    },
  });

  const handleConfirm = async () => {
    try {
      await deleteMutation.mutateAsync();
    } catch (err: any) {
      alert(err.message || 'Failed to delete medication');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[400px] rounded-feature p-7">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-card bg-stock-out-bg text-[22px]">
          ⚠️
        </div>
        <DialogTitle className="text-[19px] font-medium text-ink">Delete this medication?</DialogTitle>
        <p className="mt-2 text-[15px] leading-[1.55] text-secondary">
          This will permanently remove <strong className="font-medium text-ink">{row.generic_name}</strong> from your
          inventory. Patients currently searching for it will stop seeing your pharmacy in results.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={deleteMutation.isPending}
            className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleteMutation.isPending}
            className="h-12 flex-1 rounded-control bg-stock-out text-[15px] font-medium text-white disabled:opacity-60"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete medication'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
