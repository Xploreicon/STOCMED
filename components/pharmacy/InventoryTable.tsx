'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import EditDrugModal from './EditDrugModal';
import DeleteConfirmDialog from './DeleteConfirmDialog';

interface InventoryTableProps {
  drugs: any[];
  onRefetch: () => void;
}

function getStockBadge(stock: number, lowThreshold: number = 10) {
  if (stock === 0) {
    return {
      icon: XCircle,
      text: 'Out of Stock',
      colorClass: 'text-red-600',
      bgClass: 'bg-red-100',
    };
  } else if (stock <= lowThreshold) {
    return {
      icon: AlertTriangle,
      text: 'Low Stock',
      colorClass: 'text-orange-600',
      bgClass: 'bg-orange-100',
    };
  } else {
    return {
      icon: CheckCircle,
      text: 'In Stock',
      colorClass: 'text-green-600',
      bgClass: 'bg-green-100',
    };
  }
}

export default function InventoryTable({ drugs, onRefetch }: InventoryTableProps) {
  const [editingDrug, setEditingDrug] = useState<any | null>(null);
  const [deletingDrug, setDeletingDrug] = useState<any | null>(null);

  return (
    <>
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Image
              </th>
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
              const stockBadge = getStockBadge(
                drug.quantity_in_stock,
                drug.low_stock_threshold
              );
              const StockIcon = stockBadge.icon;

              return (
                <tr key={drug.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {drug.image_url ? (
                      <Image
                        src={drug.image_url}
                        alt={drug.name || drug.brand_name || 'Drug image'}
                        width={48}
                        height={48}
                        className="h-12 w-12 rounded-md object-cover border border-gray-200"
                        unoptimized
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                        No image
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">
                      {drug.name || drug.brand_name}
                    </div>
                    {drug.generic_name && drug.generic_name !== drug.name && (
                      <div className="text-xs text-gray-500">
                        {drug.generic_name}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-700">{drug.category}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-700 capitalize">
                      {drug.dosage_form}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-700">{drug.strength}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      ₦{drug.price?.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${stockBadge.bgClass}`}
                    >
                      <StockIcon className={`w-4 h-4 ${stockBadge.colorClass}`} />
                      <span className={`text-sm font-medium ${stockBadge.colorClass}`}>
                        {drug.quantity_in_stock}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingDrug(drug)}
                        className="hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingDrug(drug)}
                        className="hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingDrug && (
        <EditDrugModal
          isOpen={!!editingDrug}
          onClose={() => setEditingDrug(null)}
          drug={editingDrug}
          onSuccess={() => {
            onRefetch();
            setEditingDrug(null);
          }}
        />
      )}

      {/* Delete Dialog */}
      {deletingDrug && (
        <DeleteConfirmDialog
          isOpen={!!deletingDrug}
          onClose={() => setDeletingDrug(null)}
          drug={deletingDrug}
          onSuccess={() => {
            onRefetch();
            setDeletingDrug(null);
          }}
        />
      )}
    </>
  );
}
