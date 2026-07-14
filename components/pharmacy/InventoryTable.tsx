'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Pencil,
  Trash2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  CalendarClock,
  Pill,
  RotateCcw,
  ArchiveX,
  Loader2,
} from 'lucide-react';
import EditDrugModal from './EditDrugModal';
import DeleteConfirmDialog from './DeleteConfirmDialog';
import AdjustStockModal from './AdjustStockModal';

interface InventoryTableProps {
  drugs: any[];
  onRefetch: () => void;
  viewMode?: 'table' | 'grid';
}

function getStockBadge(stock: number, lowThreshold: number = 10) {
  if (stock === 0) {
    return {
      icon: XCircle,
      text: 'Out of Stock',
      colorClass: 'text-danger',
      bgClass: 'bg-danger/5 border border-danger/20',
    };
  } else if (stock <= lowThreshold) {
    return {
      icon: AlertTriangle,
      text: 'Low Stock',
      colorClass: 'text-warning',
      bgClass: 'bg-warning/5 border border-warning/20',
    };
  } else {
    return {
      icon: CheckCircle,
      text: 'In Stock',
      colorClass: 'text-success',
      bgClass: 'bg-success/5 border border-success/20',
    };
  }
}

function getExpiryAlert(expiryDateStr: string | null) {
  if (!expiryDateStr) {
    return {
      text: 'No Expiry',
      colorClass: 'text-muted-foreground bg-surface border-border border',
    };
  }
  const expiryDate = new Date(expiryDateStr);
  const today = new Date();
  const ninetyDaysFromNow = new Date();
  ninetyDaysFromNow.setDate(today.getDate() + 90);

  if (expiryDate < today) {
    return {
      text: 'Expired',
      colorClass: 'text-danger bg-danger/5 border-danger/20 border',
    };
  } else if (expiryDate <= ninetyDaysFromNow) {
    return {
      text: 'Expiring Soon',
      colorClass: 'text-warning bg-warning/5 border-warning/20 border',
    };
  }
  return {
    text: expiryDate.toLocaleDateString(),
    colorClass: 'text-muted-foreground bg-surface border-border border',
  };
}

/** Renders the drug image with pharmacy override → catalogue → placeholder fallback */
function DrugImage({ drug, size = 'md' }: { drug: any; size?: 'sm' | 'md' }) {
  const imageUrl = drug.display_image_url || drug.pharmacy_image_url || drug.image_url;
  const dims = size === 'sm' ? 'h-12 w-12' : 'h-16 w-16';
  const imgSize = size === 'sm' ? '48px' : '64px';

  if (imageUrl) {
    return (
      <div className={`relative ${dims} rounded-lg overflow-hidden border border-border shrink-0 bg-surface`}>
        <Image
          src={imageUrl}
          alt={drug.name || drug.brand_name || 'Drug image'}
          fill
          sizes={imgSize}
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div className={`${dims} rounded-lg bg-surface flex items-center justify-center shrink-0 border border-dashed border-border`}>
      <Pill className="w-5 h-5 text-muted-foreground/40" />
    </div>
  );
}

export default function InventoryTable({
  drugs,
  onRefetch,
  viewMode = 'table',
}: InventoryTableProps) {
  const [editingDrug, setEditingDrug] = useState<any | null>(null);
  const [deletingDrug, setDeletingDrug] = useState<any | null>(null);
  const [adjustingDrug, setAdjustingDrug] = useState<any | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    mutationFn: async (drugId: string) => {
      setRestoringId(drugId);
      const response = await fetch(`/api/pharmacy/drugs/${drugId}/restore`, {
        method: 'PATCH',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore drug');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      onRefetch();
    },
    onSettled: () => {
      setRestoringId(null);
    },
  });

  if (viewMode === 'grid') {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {drugs.map((drug) => {
            const isDelisted = !!drug.deleted_at;
            const stockBadge = getStockBadge(
              drug.quantity_in_stock,
              drug.low_stock_threshold
            );
            const expiryAlert = getExpiryAlert(drug.expiry_date);
            const StockIcon = stockBadge.icon;

            return (
              <div
                key={drug.id}
                className={`bg-card rounded-card border border-border overflow-hidden shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col justify-between ${
                  isDelisted ? 'opacity-60 ring-1 ring-warning/30' : ''
                }`}
              >
                <div className="p-5 space-y-4">
                  {/* Delisted badge */}
                  {isDelisted && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-warning bg-warning/10 border border-warning/20">
                      <ArchiveX className="w-3.5 h-3.5" />
                      Delisted
                    </div>
                  )}

                  {/* Image & Main Info */}
                  <div className="flex gap-4">
                    <DrugImage drug={drug} size="md" />
                    <div>
                      <div className="font-semibold text-ink line-clamp-1">
                        {drug.name || drug.brand_name}
                      </div>
                      {drug.generic_name && drug.generic_name !== drug.name && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {drug.generic_name}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground/60 mt-1">
                        {drug.strength} • {drug.dosage_form}
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2">
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${stockBadge.bgClass}`}
                    >
                      <StockIcon className="w-3.5 h-3.5" />
                      <span>{drug.quantity_in_stock} stock</span>
                    </div>

                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${expiryAlert.colorClass}`}
                    >
                      <CalendarClock className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{expiryAlert.text}</span>
                    </div>

                    {drug.quantity_in_stock <= (drug.low_stock_threshold || 10) && !isDelisted && (
                      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-danger bg-danger/5 border border-danger/20">
                        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        Reorder
                      </div>
                    )}
                  </div>

                  {/* Category and Price */}
                  <div className="pt-2 flex items-center justify-between border-t border-border text-sm">
                    <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">
                      {drug.category}
                    </span>
                    <span className="font-bold text-ink text-base tabular-nums">
                      ₦{drug.price?.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="bg-surface border-t border-border px-5 py-3 flex justify-between gap-2">
                  {isDelisted ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restoreMutation.mutate(drug.id)}
                      disabled={restoringId === drug.id}
                      className="flex-1 text-xs text-primary hover:bg-primary/5 hover:text-primary hover:border-primary/20"
                    >
                      {restoringId === drug.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          Restoring...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                          Restore
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAdjustingDrug(drug)}
                        className="flex-1 text-xs hover:bg-primary/5 hover:text-primary hover:border-primary/20"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Adjust Stock
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setEditingDrug(drug)}
                        className="h-9 w-9 hover:bg-surface"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDeletingDrug(drug)}
                    className={`h-9 w-9 ${isDelisted ? 'text-danger hover:bg-danger/5 hover:text-danger hover:border-danger/20' : 'text-danger hover:bg-danger/5 hover:text-danger hover:border-danger/20'}`}
                    title={isDelisted ? 'Already delisted' : 'Remove'}
                    disabled={isDelisted}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modals */}
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

        {adjustingDrug && (
          <AdjustStockModal
            isOpen={!!adjustingDrug}
            onClose={() => setAdjustingDrug(null)}
            row={adjustingDrug}
            onSuccess={() => {
              onRefetch();
              setAdjustingDrug(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="overflow-x-auto bg-card rounded-card border border-border shadow-card">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-surface border-b border-border">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Image
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Drug Name
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Form & Strength
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Price
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Stock
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Expiry Status
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {drugs.map((drug) => {
              const isDelisted = !!drug.deleted_at;
              const stockBadge = getStockBadge(
                drug.quantity_in_stock,
                drug.low_stock_threshold
              );
              const expiryAlert = getExpiryAlert(drug.expiry_date);
              const StockIcon = stockBadge.icon;

              return (
                <tr key={drug.id} className={`hover:bg-surface/50 transition-colors ${isDelisted ? 'opacity-50 bg-warning/5' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <DrugImage drug={drug} size="sm" />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-ink">
                        {drug.name || drug.brand_name}
                      </div>
                      {isDelisted && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-warning bg-warning/10 border border-warning/20">
                          <ArchiveX className="w-2.5 h-2.5" />
                          Delisted
                        </span>
                      )}
                    </div>
                    {drug.generic_name && drug.generic_name !== drug.name && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {drug.generic_name}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-ink-muted">{drug.category}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-ink font-medium">
                      {drug.strength}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {drug.dosage_form}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-semibold text-ink tabular-nums">
                    ₦{drug.price?.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <div
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${stockBadge.bgClass}`}
                      >
                        <StockIcon className="w-3.5 h-3.5" />
                        <span className="tabular-nums">{drug.quantity_in_stock}</span>
                      </div>
                      {drug.quantity_in_stock <= (drug.low_stock_threshold || 10) && !isDelisted && (
                        <div className="text-[10px] text-danger font-bold block pl-1">
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                            Reorder suggested
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${expiryAlert.colorClass}`}
                    >
                      {expiryAlert.text}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex gap-1 justify-end">
                      {isDelisted ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => restoreMutation.mutate(drug.id)}
                          disabled={restoringId === drug.id}
                          className="text-xs text-primary hover:bg-primary/5 hover:text-primary"
                        >
                          {restoringId === drug.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Restore
                            </>
                          )}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setAdjustingDrug(drug)}
                            className="hover:bg-primary/5 hover:text-primary"
                            title="Adjust Stock"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingDrug(drug)}
                            className="hover:bg-surface"
                            title="Edit Details"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingDrug(drug)}
                            className="hover:bg-danger/5 hover:text-danger"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
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

      {/* Stock Adjustment Modal */}
      {adjustingDrug && (
        <AdjustStockModal
          isOpen={!!adjustingDrug}
          onClose={() => setAdjustingDrug(null)}
          row={adjustingDrug}
          onSuccess={() => {
            onRefetch();
            setAdjustingDrug(null);
          }}
        />
      )}
    </>
  );
}
