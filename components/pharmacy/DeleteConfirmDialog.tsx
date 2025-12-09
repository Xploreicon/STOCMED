'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';

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
  const deleteDrugMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/pharmacy/drugs/${drug.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete drug');
      }
      return response.json();
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleConfirm = async () => {
    try {
      await deleteDrugMutation.mutateAsync();
    } catch (error: any) {
      alert(error.message || 'Failed to delete drug');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="rounded-full bg-red-100 p-3">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
          </div>
          <DialogTitle className="text-center">Delete Drug</DialogTitle>
          <DialogDescription className="text-center">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-gray-900">
              {drug?.name || drug?.brand_name}
            </span>
            ? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={deleteDrugMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleteDrugMutation.isPending}
          >
            {deleteDrugMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              'Yes, Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
