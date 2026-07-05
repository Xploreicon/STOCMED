'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { Package, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import InventoryTable from '@/components/pharmacy/InventoryTable';
import AddDrugModal from '@/components/pharmacy/AddDrugModal';
import EditDrugModal from '@/components/pharmacy/EditDrugModal';
import DeleteConfirmDialog from '@/components/pharmacy/DeleteConfirmDialog';
import AdjustStockModal from '@/components/pharmacy/AdjustStockModal';
import BulkImportModal from '@/components/pharmacy/BulkImportModal';
import PosModal from '@/components/pharmacy/PosModal';
import UnmetDemandCard from '@/components/pharmacy/UnmetDemandCard';
import { STATUS_FILTERS, matchesFilter, type StatusFilterKey } from '@/lib/inventoryUi';
import type { EnrichedInventoryRow, InventoryStats } from '@/lib/pharmacyInventory';

export const dynamic = 'force-dynamic';

const PER_PAGE = 8;

// Legacy query param values linked from the pharmacy dashboard's quick actions.
const LEGACY_FILTER_MAP: Record<string, StatusFilterKey> = {
  in_stock: 'in',
  low_stock: 'low',
  out_of_stock: 'out',
};

type Modal = { type: 'add' | 'edit' | 'delete' | 'adjust' | 'bulk' | 'pos'; row?: EnrichedInventoryRow } | null;

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return isOnline;
}

export default function PharmacyInventory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, isPharmacy } = useUser();
  const isOnline = useOnlineStatus();

  const rawFilterParam = searchParams.get('filter') || 'all';
  const [filter, setFilter] = useState<StatusFilterKey>(
    (LEGACY_FILTER_MAP[rawFilterParam] ?? (rawFilterParam as StatusFilterKey)) || 'all'
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [prefillName, setPrefillName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/inventory');
    }
  }, [user, authLoading, isPharmacy, router]);

  const {
    data: drugsData,
    isLoading,
    isError,
    refetch,
  } = useQuery<{ drugs: EnrichedInventoryRow[]; stats: InventoryStats }>({
    queryKey: ['pharmacy-drugs'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/drugs');
      if (!response.ok) throw new Error('Failed to fetch drugs');
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  const { data: pharmacyProfile } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/profile');
      if (!response.ok) throw new Error('Failed to fetch pharmacy profile');
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  const stats = drugsData?.stats;

  const allRows = useMemo(() => drugsData?.drugs ?? [], [drugsData]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows
      .filter((row) => matchesFilter(row, filter))
      .filter((row) => !q || row.generic_name.toLowerCase().includes(q) || row.brand_name?.toLowerCase().includes(q));
  }, [allRows, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filteredRows.slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE);

  const closeModal = () => {
    setModal(null);
    setPrefillName(undefined);
  };

  const handleModalSuccess = () => {
    closeModal();
    refetch();
  };

  const openAddFromDemand = (drugName: string) => {
    setPrefillName(drugName);
    setModal({ type: 'add' });
  };

  const isEmpty = !isLoading && !isError && allRows.length === 0;
  const showMainContent = !isLoading && !isEmpty;

  const statCards = stats
    ? [
        { icon: Package, label: 'Total products', value: stats.total, color: 'text-brand-deep' },
        { icon: CheckCircle2, label: 'In stock', value: stats.in_stock, color: 'text-stock-in' },
        { icon: AlertTriangle, label: 'Low stock', value: stats.low_stock, color: 'text-stock-low' },
        { icon: XCircle, label: 'Out of stock', value: stats.out_of_stock, color: 'text-stock-out' },
        { icon: Clock, label: 'Expiring soon', value: stats.expiring_soon, color: 'text-stock-low' },
      ]
    : [];

  if (authLoading) {
    return <div className="min-h-screen" />;
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-[1000px]">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-medium text-ink">Inventory</h1>
              <span className="whitespace-nowrap rounded-full border border-hairline bg-brand-tint px-2.5 py-1 text-[13px] font-medium text-brand">
                {stats?.total ?? 0} products
              </span>
              {isOnline ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-stock-in-bg px-2.5 py-1 text-xs font-medium text-stock-in">
                  <span className="h-1.5 w-1.5 rounded-full bg-stock-in" />
                  Synced
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-stock-low-bg px-2.5 py-1 text-xs font-medium text-stock-low">
                  <span className="h-1.5 w-1.5 rounded-full bg-stock-low" />
                  Offline — changes will sync when you reconnect
                </span>
              )}
              {pharmacyProfile?.is_verified && (
                <span className="whitespace-nowrap rounded-full bg-stock-in-bg px-2.5 py-1 text-xs font-medium text-stock-in">
                  ✓ Verified · Priority listed
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-secondary">Manage what&apos;s on your shelves and how patients find it</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => setModal({ type: 'pos' })}
              className="flex h-11 items-center justify-center whitespace-nowrap rounded-control border-[1.5px] border-brand px-[18px] text-sm font-medium text-brand"
            >
              Open POS
            </button>
            <button
              onClick={() => setModal({ type: 'bulk' })}
              className="flex h-11 items-center justify-center whitespace-nowrap rounded-control border-[1.5px] border-brand px-[18px] text-sm font-medium text-brand"
            >
              Bulk import
            </button>
            <button
              onClick={() => setModal({ type: 'add' })}
              className="flex h-11 items-center justify-center whitespace-nowrap rounded-control bg-brand px-[18px] text-sm font-medium text-white"
            >
              + Add drug
            </button>
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-4 py-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-card border border-hairline p-4">
                  <div className="h-3 w-20 animate-pulse rounded bg-hairline" />
                  <div className="mt-2 h-6 w-12 animate-pulse rounded bg-hairline" />
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-card border border-hairline">
              <div className="h-11 bg-brand-tint" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-8 border-b border-hairline px-4 py-3.5 last:border-b-0">
                  <div className="h-3.5 w-36 animate-pulse rounded bg-hairline" />
                  <div className="h-3.5 w-20 animate-pulse rounded bg-hairline" />
                  <div className="h-3.5 w-12 animate-pulse rounded bg-hairline" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty inventory state */}
        {isEmpty && (
          <div className="mt-2 flex flex-col items-center gap-2 rounded-feature border border-dashed border-hairline px-8 py-16 text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-feature bg-brand-tint text-2xl">
              📦
            </div>
            <h3 className="text-lg font-medium text-ink">Your inventory is empty</h3>
            <p className="max-w-[380px] text-sm leading-relaxed text-secondary">
              Import your NAFDAC-registered catalogue to get started. Patients near your pharmacy are already
              searching — list your stock so they can find you.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => setModal({ type: 'bulk' })}
                className="flex h-12 items-center justify-center rounded-control border-[1.5px] border-brand px-6 text-[15px] font-medium text-brand"
              >
                Bulk import catalogue
              </button>
              <button
                onClick={() => setModal({ type: 'add' })}
                className="flex h-12 items-center justify-center rounded-control bg-brand px-6 text-[15px] font-medium text-white"
              >
                + Add your first drug
              </button>
            </div>
          </div>
        )}

        {isError && !isLoading && (
          <div className="mt-2 rounded-card border border-hairline p-6 text-center text-sm text-secondary">
            Couldn&apos;t load your inventory. Check your connection and try again.
          </div>
        )}

        {showMainContent && (
          <>
            {/* Summary stat row */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {statCards.map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="rounded-card border border-hairline p-3.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`h-3.5 w-3.5 ${s.color}`} />
                      <span className="whitespace-nowrap text-xs text-muted">{s.label}</span>
                    </div>
                    <div className={`mt-1.5 text-[22px] font-medium tabular-nums ${s.color}`}>{s.value}</div>
                  </div>
                );
              })}
            </div>

            {/* Toolbar */}
            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search medications…"
                className="h-11 min-w-[200px] flex-1 rounded-control border border-hairline bg-white px-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((f) => {
                  const active = filter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => {
                        setFilter(f.key);
                        setPage(0);
                      }}
                      className="flex h-11 items-center whitespace-nowrap rounded-control border px-3.5 text-[13px] font-medium"
                      style={{
                        color: active ? '#FFFFFF' : '#4A4A4A',
                        background: active ? '#0066CC' : '#FFFFFF',
                        borderColor: active ? '#0066CC' : '#E6EEF7',
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="rounded-card border border-hairline p-10 text-center text-sm text-secondary">
                No medications match your search or filter.
              </div>
            ) : (
              <InventoryTable
                rows={pageRows}
                onEdit={(row) => setModal({ type: 'edit', row })}
                onAdjust={(row) => setModal({ type: 'adjust', row })}
                onDelete={(row) => setModal({ type: 'delete', row })}
              />
            )}

            {/* Pagination */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted">
                Showing {filteredRows.length === 0 ? 0 : currentPage * PER_PAGE + 1}–
                {Math.min((currentPage + 1) * PER_PAGE, filteredRows.length)} of {filteredRows.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-control border border-hairline text-sm text-secondary"
                >
                  ←
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className="flex h-10 w-10 items-center justify-center rounded-control border text-sm font-medium"
                    style={{
                      background: i === currentPage ? '#0066CC' : '#FFFFFF',
                      color: i === currentPage ? '#FFFFFF' : '#4A4A4A',
                      borderColor: i === currentPage ? '#0066CC' : '#E6EEF7',
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-control border border-hairline text-sm text-secondary"
                >
                  →
                </button>
              </div>
            </div>

            <UnmetDemandCard onAdd={openAddFromDemand} />
          </>
        )}
      </div>

      <AddDrugModal
        isOpen={modal?.type === 'add'}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        prefillName={prefillName}
      />
      {modal?.type === 'edit' && modal.row && (
        <EditDrugModal isOpen row={modal.row} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal?.type === 'delete' && modal.row && (
        <DeleteConfirmDialog isOpen row={modal.row} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal?.type === 'adjust' && modal.row && (
        <AdjustStockModal isOpen row={modal.row} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      <BulkImportModal isOpen={modal?.type === 'bulk'} onClose={closeModal} onSuccess={handleModalSuccess} />
      <PosModal isOpen={modal?.type === 'pos'} onClose={closeModal} rows={allRows} />
    </div>
  );
}
