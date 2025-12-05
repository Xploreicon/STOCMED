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
      colorClass: 'text-green-600',
      bgClass: 'bg-green-100'
    }
  } else if (stock >= 5) {
    return {
      icon: AlertTriangle,
      text: 'Low Stock',
      colorClass: 'text-orange-600',
      bgClass: 'bg-orange-100'
    }
  } else {
    return {
      icon: XCircle,
      text: 'Out of Stock',
      colorClass: 'text-red-600',
      bgClass: 'bg-red-100'
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
              <h3 className="font-semibold text-gray-900 text-lg">{drug.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{drug.category}</p>
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
              <span className="text-gray-500">Form:</span>
              <p className="font-medium text-gray-900">{drug.form}</p>
            </div>
            <div>
              <span className="text-gray-500">Strength:</span>
              <p className="font-medium text-gray-900">{drug.strength}</p>
            </div>
            <div>
              <span className="text-gray-500">Price:</span>
              <p className="font-medium text-gray-900">₦{drug.price.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>
              <p className={`font-medium ${stockBadge.colorClass}`}>{stockBadge.text}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
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
