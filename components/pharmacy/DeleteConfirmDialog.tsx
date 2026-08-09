'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, Loader2, ArchiveX, Info } from 'lucide-react';
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal';
import { clearCachedSpToken, getCachedSpToken, withSpAuthorizationHeader } from '@/lib/sp-authorization-client';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  drug: any;
  onSuccess: () => void;
}

export default function DeleteConfirmDialog({
  isOpen,
  onClose,
  drug,
  onSuccess,
}: DeleteConfirmDialogProps) {
  const queryClient = useQueryClient();
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [showSpAuthorization, setShowSpAuthorization] = useState(false);

  const deleteDrugMutation = useMutation({
    mutationFn: async (token: string | null) => {
      const response = await fetch(`/api/pharmacy/drugs/${drug.id}`, {
        method: 'DELETE',
        headers: withSpAuthorizationHeader('delist_inventory', token),
      });
      const data = await response.json();
      if (!response.ok) {
        const failure = new Error(data.error || 'Failed to remove drug');
        if (response.status === 403 && data.code === 'SP_AUTH_REQUIRED') {
          clearCachedSpToken('delist_inventory');
          failure.name = 'SP_AUTH_REQUIRED';
        }
        throw failure;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-drugs'],
        refetchType: 'active',
      });
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-stats'],
        refetchType: 'active',
      });
      setResultMessage(data.message || 'Done.');
      // Brief delay so the pharmacist sees the success message
      setTimeout(() => {
        setResultMessage(null);
        onSuccess();
      }, 1500);
    },
  });

  const removeInventory = async (token: string | null) => {
    try {
      await deleteDrugMutation.mutateAsync(token);
    } catch (error: any) {
      if (error instanceof Error && error.name === 'SP_AUTH_REQUIRED') setShowSpAuthorization(true);
    }
  };

  const handleConfirm = async () => {
    await removeInventory(getCachedSpToken('delist_inventory'));
  };

  const handleClose = () => {
    if (!deleteDrugMutation.isPending) {
      setResultMessage(null);
      onClose();
    }
  };

  const drugName = drug?.name || drug?.brand_name || drug?.generic_name || 'this item';

  // Determine if this item has trade history (heuristic: check if quantity differs from 0
  // or if there are batches — the actual decision happens server-side, this is just for UI copy)
  const hasTradeHistory = drug?.quantity_in_stock > 0 || (drug?.batches && drug.batches.length > 1);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className={`rounded-full p-3 ${hasTradeHistory ? 'bg-warning/10' : 'bg-danger/10'}`}>
              {hasTradeHistory ? (
                <ArchiveX className="h-6 w-6 text-warning" />
              ) : (
                <Trash2 className="h-6 w-6 text-danger" />
              )}
            </div>
          </div>
          <DialogTitle className="text-center">
            {hasTradeHistory ? 'Remove from Inventory' : 'Delete Drug'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {hasTradeHistory ? (
              <>
                Remove{' '}
                <span className="font-semibold text-ink">{drugName}</span>{' '}
                from your active inventory? It will no longer appear in patient
                search or your inventory list.
              </>
            ) : (
              <>
                Permanently delete{' '}
                <span className="font-semibold text-ink">{drugName}</span>?
                This item has no trade history and will be fully removed.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Info note for delist */}
        {hasTradeHistory && (
          <div className="mx-1 p-3 bg-surface border border-border rounded-lg flex items-start gap-2.5 text-xs text-ink-muted">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <span>
              Sales history, ledger entries, and batch records will be preserved.
              You can restore this item later from the &quot;Delisted&quot; filter.
            </span>
          </div>
        )}

        {/* Error display */}
        {deleteDrugMutation.isError && (
          <div className="mx-1 p-3 bg-danger/5 border border-danger/20 text-danger rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{(deleteDrugMutation.error as any)?.message || 'Something went wrong. Please try again.'}</span>
          </div>
        )}

        {/* Success display */}
        {resultMessage && (
          <div className="mx-1 p-3 bg-success/5 border border-success/20 text-success rounded-lg text-sm text-center font-medium">
            {resultMessage}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={deleteDrugMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={hasTradeHistory ? 'default' : 'destructive'}
            onClick={handleConfirm}
            disabled={deleteDrugMutation.isPending || !!resultMessage}
            className={hasTradeHistory ? 'bg-warning hover:bg-warning/90 text-white' : ''}
          >
            {deleteDrugMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {hasTradeHistory ? 'Removing...' : 'Deleting...'}
              </>
            ) : resultMessage ? (
              'Done'
            ) : hasTradeHistory ? (
              'Delist'
            ) : (
              'Delete Permanently'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SpAuthorizationModal
      open={showSpAuthorization}
      action="delist_inventory"
      description={`Authorise removing ${drugName} from active inventory`}
      onAuthorized={(token) => {
        setShowSpAuthorization(false);
        void removeInventory(token);
      }}
      onClose={() => setShowSpAuthorization(false)}
    />
    </>
  );
}
