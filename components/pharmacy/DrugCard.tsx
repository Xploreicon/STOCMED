import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import type { Drug } from '@/types/drug'

interface DrugCardProps {
  drug: Drug
  onEdit: (drug: Drug) => void
  onDelete: (drug: Drug) => void
}

function getStockBadge(stock: number) {
  if (stock > 20) {
    return {
      icon: CheckCircle,
      text: 'In Stock',
      colorClass: 'text-success',
      bgClass: 'bg-success/10'
    }
  } else if (stock >= 5) {
    return {
      icon: AlertTriangle,
      text: 'Low Stock',
      colorClass: 'text-warning',
      bgClass: 'bg-warning/10'
    }
  } else {
    return {
      icon: XCircle,
      text: 'Out of Stock',
      colorClass: 'text-danger',
      bgClass: 'bg-danger/10'
    }
  }
}

export function DrugCard({ drug, onEdit, onDelete }: DrugCardProps) {
  const stockBadge = getStockBadge(drug.stock)
  const StockIcon = stockBadge.icon

  return (
    <Card className="w-full hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header with name and stock badge */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold text-ink text-lg">{drug.name}</h3>
              <p className="text-sm text-ink-muted mt-1">{drug.category}</p>
            </div>
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${stockBadge.bgClass}`}>
              <StockIcon className={`w-4 h-4 ${stockBadge.colorClass}`} />
              <span className={`text-xs font-medium ${stockBadge.colorClass}`}>
                {drug.stock}
              </span>
            </div>
          </div>

          {/* Drug details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-ink-muted">Form:</span>
              <p className="font-medium text-ink">{drug.form}</p>
            </div>
            <div>
              <span className="text-ink-muted">Strength:</span>
              <p className="font-medium text-ink">{drug.strength}</p>
            </div>
            <div>
              <span className="text-ink-muted">Price:</span>
              <p className="font-medium text-ink">₦{drug.price.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-ink-muted">Status:</span>
              <p className={`font-medium ${stockBadge.colorClass}`}>{stockBadge.text}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onEdit(drug)}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              onClick={() => onDelete(drug)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
