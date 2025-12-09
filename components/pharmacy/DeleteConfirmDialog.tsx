import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  drugName: string
  onConfirm: () => void
  loading?: boolean
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  onOpenChange,
  drugName,
  onConfirm,
  loading = false,
}) => {
  const handleConfirm = () => {
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="rounded-full bg-red-100 p-3">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
          </div>
          <DialogTitle className="text-center">Delete Drug</DialogTitle>
          <DialogDescription className="text-center">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-gray-900">{drugName}</span>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Deleting..." : "Yes, Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
