'use client';

import { useState } from 'react';
import type { EnrichedInventoryRow } from '@/lib/pharmacyInventory';
import { formatNaira, formatExpiry, getRowBadge, getBatchBadge } from '@/lib/inventoryUi';

interface InventoryTableProps {
  rows: EnrichedInventoryRow[];
  onEdit: (row: EnrichedInventoryRow) => void;
  onAdjust: (row: EnrichedInventoryRow) => void;
  onDelete: (row: EnrichedInventoryRow) => void;
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function Badge({ badge }: { badge: ReturnType<typeof getRowBadge> }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={
        badge.outline
          ? { color: badge.color, background: badge.bg, border: `1px solid ${badge.color}` }
          : { color: badge.color, background: badge.bg }
      }
    >
      {badge.label}
    </span>
  );
}

function BatchList({ row }: { row: EnrichedInventoryRow }) {
  if (row.batches.length === 0) {
    return <p className="text-sm text-secondary">No batches recorded for this medication yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mb-1 text-xs font-medium text-secondary">Batches</div>
      {row.batches.map((b) => {
        const badge = getBatchBadge(b);
        return (
          <div
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-white px-3 py-2"
          >
            <span className="text-sm font-medium text-ink">Batch {b.batch_number}</span>
            <span className="text-sm text-secondary">Qty {b.remaining_qty}</span>
            <span className="text-sm font-medium" style={{ color: badge.color }}>
              {badge.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function InventoryTable({ rows, onEdit, onAdjust, onDelete }: InventoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card border border-hairline md:block">
        <div className="grid grid-cols-[1.6fr_1fr_0.8fr_0.6fr_0.9fr_0.9fr] border-b border-hairline bg-brand-tint px-4 py-3">
          <span className="text-[13px] font-medium text-secondary">Product</span>
          <span className="text-[13px] font-medium text-secondary">Strength &amp; form</span>
          <span className="text-[13px] font-medium text-secondary">Price</span>
          <span className="text-[13px] font-medium text-secondary">Qty</span>
          <span className="text-[13px] font-medium text-secondary">Earliest expiry</span>
          <span className="text-right text-[13px] font-medium text-secondary">Actions</span>
        </div>
        {rows.map((row) => {
          const badge = getRowBadge(row);
          const expanded = expandedId === row.id;
          return (
            <div key={row.id}>
              <div className="grid grid-cols-[1.6fr_1fr_0.8fr_0.6fr_0.9fr_0.9fr] items-center border-b border-hairline px-4 py-3.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{row.generic_name}</div>
                  {row.brand_name && <div className="mt-0.5 truncate text-xs text-muted">{row.brand_name}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge badge={badge} />
                    {row.stock_status === 'low' && (
                      <span className="text-[11px] text-stock-low">Reorder suggested</span>
                    )}
                  </div>
                </div>
                <span className="text-[13px] text-secondary">
                  {row.strength} {row.dosage_form ? `· ${capitalize(row.dosage_form)}` : ''}
                </span>
                <span className="font-medium tabular-nums text-brand-deep">{formatNaira(row.price)}</span>
                <span className="font-medium tabular-nums text-ink">{row.quantity_in_stock}</span>
                <span
                  className="text-[13px]"
                  style={{ color: row.is_expired ? '#E24B4A' : row.is_expiring_soon ? '#BA7517' : '#4A4A4A' }}
                >
                  {formatExpiry(row.expiry_date)}
                </span>
                <div className="flex flex-wrap justify-end gap-3">
                  <button onClick={() => onEdit(row)} className="text-[13px] font-medium text-brand">
                    Edit
                  </button>
                  <button onClick={() => onAdjust(row)} className="text-[13px] font-medium text-brand">
                    Adjust stock
                  </button>
                  <button onClick={() => onDelete(row)} className="text-[13px] font-medium text-stock-out">
                    Delete
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                    className="text-[13px] font-medium text-secondary"
                  >
                    {expanded ? 'Hide batches' : 'View batches'}
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="border-b border-hairline bg-brand-tint px-4 py-3">
                  <BatchList row={row} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => {
          const badge = getRowBadge(row);
          const expanded = expandedId === row.id;
          return (
            <div key={row.id} className="rounded-card border border-hairline p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-ink">{row.generic_name}</div>
                  {row.brand_name && <div className="mt-0.5 truncate text-xs text-muted">{row.brand_name}</div>}
                </div>
                <div className="shrink-0">
                  <Badge badge={badge} />
                </div>
              </div>
              {row.stock_status === 'low' && (
                <div className="mt-1.5 text-[11px] text-stock-low">Reorder suggested</div>
              )}
              <div className="mt-2.5 flex flex-wrap gap-4 text-[13px] text-secondary">
                <span>
                  {row.strength} {row.dosage_form ? `· ${capitalize(row.dosage_form)}` : ''}
                </span>
                <span>Qty: {row.quantity_in_stock}</span>
                <span className="font-medium tabular-nums text-brand-deep">{formatNaira(row.price)}</span>
              </div>
              <div
                className="mt-1.5 text-[13px]"
                style={{ color: row.is_expired ? '#E24B4A' : row.is_expiring_soon ? '#BA7517' : '#4A4A4A' }}
              >
                Expiry: {formatExpiry(row.expiry_date)}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 border-t border-hairline pt-3">
                <button onClick={() => onEdit(row)} className="text-[13px] font-medium text-brand">
                  Edit
                </button>
                <button onClick={() => onAdjust(row)} className="text-[13px] font-medium text-brand">
                  Adjust stock
                </button>
                <button onClick={() => onDelete(row)} className="text-[13px] font-medium text-stock-out">
                  Delete
                </button>
                <button
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  className="text-[13px] font-medium text-secondary"
                >
                  {expanded ? 'Hide batches' : 'View batches'}
                </button>
              </div>
              {expanded && (
                <div className="mt-3 rounded-lg bg-brand-tint p-3">
                  <BatchList row={row} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
