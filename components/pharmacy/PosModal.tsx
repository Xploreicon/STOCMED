'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { EnrichedInventoryRow } from '@/lib/pharmacyInventory';
import { formatNaira } from '@/lib/inventoryUi';

interface PosModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: EnrichedInventoryRow[];
}

interface CartLine {
  row: EnrichedInventoryRow;
  qty: number;
}

export default function PosModal({ isOpen, onClose, rows }: PosModalProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return rows
      .filter((r) => r.quantity_in_stock > 0 && (r.generic_name.toLowerCase().includes(q) || r.brand_name?.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [query, rows]);

  const addToCart = (row: EnrichedInventoryRow) => {
    setQuery('');
    setCart((prev) => {
      const existing = prev.find((l) => l.row.id === row.id);
      if (existing) {
        return prev.map((l) => (l.row.id === row.id ? { ...l, qty: Math.min(l.qty + 1, row.quantity_in_stock) } : l));
      }
      return [...prev, { row, qty: 1 }];
    });
  };

  const updateQty = (rowId: string, qty: number) => {
    setCart((prev) => prev.map((l) => (l.row.id === rowId ? { ...l, qty: Math.max(1, qty) } : l)));
  };

  const removeLine = (rowId: string) => {
    setCart((prev) => prev.filter((l) => l.row.id !== rowId));
  };

  const total = cart.reduce((sum, l) => sum + l.row.price * l.qty, 0);

  const resetAndClose = () => {
    setCart([]);
    setQuery('');
    setError(null);
    onClose();
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    setIsCompleting(true);
    setError(null);
    try {
      for (const line of cart) {
        const response = await fetch(`/api/pharmacy/drugs/${line.row.id}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'Sale',
            quantity: line.qty,
            reason: 'POS sale',
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || `Failed to complete sale for ${line.row.generic_name}`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
      resetAndClose();
    } catch (err: any) {
      setError(err.message || 'Failed to complete sale');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[85vh] max-w-[420px] overflow-y-auto rounded-feature p-7">
        <div className="mb-2 flex items-center justify-between">
          <DialogTitle className="text-xl font-medium text-ink">Point of sale</DialogTitle>
          <button
            onClick={resetAndClose}
            className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-secondary">
          Ring up an in-store sale. Stock updates automatically when you complete a sale.
        </p>
        <div className="relative mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan or search medication…"
            className="h-12 w-full rounded-control border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          {results.length > 0 && (
            <div className="absolute left-0 right-0 top-[52px] z-10 flex flex-col gap-1 rounded-control border border-hairline bg-white p-1.5 shadow-sm">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => addToCart(r)}
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-brand-tint"
                >
                  <span className="text-sm text-ink">{r.generic_name}</span>
                  <span className="text-xs text-secondary">{formatNaira(r.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {cart.length === 0 ? (
          <p className="rounded-card border border-hairline px-4 py-6 text-center text-sm text-muted">
            Search above to add items to this sale.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {cart.map((line) => (
              <div key={line.row.id} className="flex items-center justify-between gap-3 rounded-card border border-hairline p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{line.row.generic_name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    {formatNaira(line.row.price)} ×
                    <input
                      type="number"
                      min={1}
                      max={line.row.quantity_in_stock}
                      value={line.qty}
                      onChange={(e) => updateQty(line.row.id, parseInt(e.target.value, 10) || 1)}
                      className="h-6 w-12 rounded border border-hairline px-1 text-center text-xs"
                    />
                    <button onClick={() => removeLine(line.row.id)} className="text-stock-out">
                      Remove
                    </button>
                  </div>
                </div>
                <div className="shrink-0 text-[15px] font-medium text-brand-deep">
                  {formatNaira(line.row.price * line.qty)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-5 mt-5 flex items-center justify-between border-t border-hairline pt-3">
          <span className="text-[15px] font-medium text-ink">Total</span>
          <span className="text-xl font-medium text-brand-deep">{formatNaira(total)}</span>
        </div>
        {error && <p className="mb-3 text-xs text-stock-out">{error}</p>}
        <button
          onClick={handleCompleteSale}
          disabled={cart.length === 0 || isCompleting}
          className="h-12 w-full rounded-control bg-brand text-[15px] font-medium text-white disabled:opacity-50"
        >
          {isCompleting ? 'Completing…' : 'Complete sale'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
