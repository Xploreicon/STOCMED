import { Button } from '@/components/ui/button'
import { Pencil, Trash2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import type { Drug } from '@/types/drug'

interface InventoryTableProps {
  drugs: Drug[]
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

export function InventoryTable({ drugs, onEdit, onDelete }: InventoryTableProps) {
  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Drug Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Category
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Form
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Strength
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Price
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Stock
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {drugs.map((drug) => {
            const stockBadge = getStockBadge(drug.stock)
            const StockIcon = stockBadge.icon

            return (
              <tr key={drug.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium text-gray-900">{drug.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-700">{drug.category}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-700">{drug.form}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-700">{drug.strength}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    ₦{drug.price.toLocaleString()}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${stockBadge.bgClass}`}>
                    <StockIcon className={`w-4 h-4 ${stockBadge.colorClass}`} />
                    <span className={`text-sm font-medium ${stockBadge.colorClass}`}>
                      {drug.stock}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(drug)}
                      className="hover:bg-blue-50 hover:text-blue-600"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(drug)}
                      className="hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
