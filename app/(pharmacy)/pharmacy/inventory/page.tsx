'use client';

import { Button } from '@/components/ui/button'

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import {
  AlertTriangle,
  ArchiveX,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import InventoryTable from '@/components/pharmacy/InventoryTable';
import AddDrugModal from '@/components/pharmacy/AddDrugModal';
import AddStoreItemModal from '@/components/pharmacy/AddStoreItemModal';

export const dynamic = 'force-dynamic';

export default function PharmacyInventory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, isPharmacy } = useUser();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [department, setDepartment] = useState<'all' | 'medicine' | 'store'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const showDelisted = filterStatus === 'delisted';

  const addProductId = searchParams.get('add_product_id');
  const addProductName = searchParams.get('name');
  const addProductStrength = searchParams.get('strength');
  const addProductDosageForm = searchParams.get('dosage_form');
  const addProductCategory = searchParams.get('category');

  const preselectedProduct = addProductId ? {
    id: addProductId,
    generic_name: addProductName || '',
    strength: addProductStrength || '',
    dosage_form: addProductDosageForm || '',
    category: addProductCategory || 'Others'
  } : null;

  useEffect(() => {
    if (addProductId) {
      setIsAddModalOpen(true);
    }
  }, [addProductId]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    const updateViewMode = () => setViewMode(desktop.matches ? 'table' : 'grid');
    updateViewMode();
    desktop.addEventListener('change', updateViewMode);
    return () => desktop.removeEventListener('change', updateViewMode);
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/inventory');
    }
  }, [user, authLoading, isPharmacy, router]);

  const { data: drugsData, isLoading, refetch } = useQuery({
    queryKey: ['pharmacy-drugs', showDelisted],
    queryFn: async () => {
      const url = showDelisted
        ? '/api/pharmacy/drugs?show_delisted=true'
        : '/api/pharmacy/drugs';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch drugs');
      }
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-ink-muted text-lg">Loading inventory...</p>
        </div>
      </div>
    );
  }

  const drugs = drugsData?.drugs || [];
  const departmentItems = department === 'all'
    ? drugs
    : drugs.filter((item: any) => item.item_type === department);
  const totalProducts = departmentItems.length;

  // Compute stat counts dynamically
  const today = new Date();
  const ninetyDaysFromNow = new Date();
  ninetyDaysFromNow.setDate(today.getDate() + 90);

  const inStock = departmentItems.filter((d: any) => d.quantity_in_stock > (d.low_stock_threshold || 10)).length;
  const lowStock = departmentItems.filter((d: any) => d.quantity_in_stock > 0 && d.quantity_in_stock <= (d.low_stock_threshold || 10)).length;
  const outOfStock = departmentItems.filter((d: any) => d.quantity_in_stock === 0).length;

  const expiringSoon = departmentItems.filter((d: any) => {
    if (!d.expiry_date) return false;
    const exp = new Date(d.expiry_date);
    return exp >= today && exp <= ninetyDaysFromNow;
  }).length;

  const expired = departmentItems.filter((d: any) => {
    if (!d.expiry_date) return false;
    const exp = new Date(d.expiry_date);
    return exp < today;
  }).length;

  // Filter logic
  const filteredDrugs = departmentItems.filter((drug: any) => {
    const matchesSearch = searchQuery
      ? drug.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.generic_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.brand_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.category?.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    let matchesStatus = true;
    if (filterStatus === 'delisted') {
      matchesStatus = !!drug.deleted_at;
    } else if (filterStatus === 'in_stock') {
      matchesStatus = !drug.deleted_at && drug.quantity_in_stock > (drug.low_stock_threshold || 10);
    } else if (filterStatus === 'low_stock') {
      matchesStatus =
        !drug.deleted_at &&
        drug.quantity_in_stock > 0 &&
        drug.quantity_in_stock <= (drug.low_stock_threshold || 10);
    } else if (filterStatus === 'out_of_stock') {
      matchesStatus = !drug.deleted_at && drug.quantity_in_stock === 0;
    } else if (filterStatus === 'expiring_soon') {
      if (!drug.expiry_date || drug.deleted_at) {
        matchesStatus = false;
      } else {
        const exp = new Date(drug.expiry_date);
        matchesStatus = exp >= today && exp <= ninetyDaysFromNow;
      }
    } else if (filterStatus === 'expired') {
      if (!drug.expiry_date || drug.deleted_at) {
        matchesStatus = false;
      } else {
        const exp = new Date(drug.expiry_date);
        matchesStatus = exp < today;
      }
    } else {
      // 'all' — only show active items
      matchesStatus = !drug.deleted_at;
    }

    return matchesSearch && matchesStatus;
  });

  const stats: Array<{ label: string; value: number; icon: LucideIcon; color: string }> = [
    { label: 'Total products', value: totalProducts, icon: Boxes, color: 'var(--navy)' },
    { label: 'In stock', value: inStock, icon: CheckCircle2, color: 'var(--success)' },
    { label: 'Low stock', value: lowStock, icon: AlertTriangle, color: 'var(--warning)' },
    { label: 'Out of stock', value: outOfStock, icon: XCircle, color: 'var(--danger)' },
    { label: 'Expiring soon', value: expiringSoon, icon: CalendarClock, color: 'var(--warning)' },
  ];

  const delistedCount = departmentItems.filter((d: any) => !!d.deleted_at).length;

  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'in_stock', label: 'In stock' },
    { value: 'low_stock', label: 'Low stock' },
    { value: 'out_of_stock', label: 'Out of stock' },
    { value: 'expiring_soon', label: 'Expiring soon' },
    { value: 'expired', label: 'Expired' },
    { value: 'delisted', label: `Delisted${delistedCount > 0 ? ` (${delistedCount})` : ''}` },
  ];

  return (
    <div className="w-full min-w-0 max-w-[1000px] mx-auto py-2">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[24px] font-medium text-ink">Inventory</h1>
            <span className="text-[13px] font-medium text-primary bg-[var(--surface)] border border-border px-2.5 py-1 rounded-full whitespace-nowrap">
              {totalProducts} {totalProducts === 1 ? 'product' : 'products'}
            </span>
          </div>
          <p className="text-[14px] text-ink-muted mt-1.5">
            Manage medicines and front-store stock from one ledger
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2.5 flex-wrap">
          <Button
            onClick={() => router.push('/pharmacy/pos')}
            className="h-11 flex items-center px-4 bg-white text-primary border-[1.5px] border-primary font-medium text-[14px] rounded-button hover:bg-surface transition-colors"
          >
            Open POS
          </Button>
          <Button
            onClick={() => router.push('/pharmacy/inventory/import')}
            className="h-11 flex items-center px-4 bg-white text-primary border-[1.5px] border-primary font-medium text-[14px] rounded-button hover:bg-surface transition-colors"
          >
            Bulk import
          </Button>
          <Button
            onClick={() => setIsAddModalOpen(true)}
            className="h-11 flex items-center px-4 bg-primary text-white font-medium text-[14px] rounded-button hover:bg-[var(--primary-hover)] transition-colors"
          >
            <Plus className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Add medicine
          </Button>
          <Button
            onClick={() => setIsStoreModalOpen(true)}
            className="h-11 flex items-center px-4 bg-ink text-white font-medium text-[14px] rounded-button hover:bg-ink/90 transition-colors"
          >
            <Plus className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Add store item
          </Button>
        </div>
      </div>

      {/* Summary Stat Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {stats.map((s, idx) => (
          <div key={idx} className="border border-border rounded-card p-3.5 bg-white">
            <div className="flex items-center gap-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <s.icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="min-w-0 text-[12px] text-ink-light leading-tight">{s.label}</span>
            </div>
            <div
              style={{ color: s.color }}
              className="text-[22px] font-medium mt-1.5 tabular-nums"
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 inline-flex rounded-md border border-border bg-white p-1 shadow-sm">
        {([
          ['all', `All (${drugs.length})`],
          ['medicine', `Medicines (${drugs.filter((item: any) => item.item_type === 'medicine').length})`],
          ['store', `Store (${drugs.filter((item: any) => item.item_type === 'store').length})`],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            onClick={() => setDepartment(value)}
            className={`h-9 rounded px-4 text-sm font-semibold transition-colors ${
              department === value ? 'bg-primary text-white shadow-sm' : 'bg-transparent text-ink-muted hover:bg-surface'
            }`}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search inventory..."
          className="flex-1 h-11 border border-border rounded-button px-4 text-[14px] text-ink bg-white focus:outline-none focus:border-primary min-w-[200px]"
        />
        <div className="flex gap-2 flex-wrap">
          {filterOptions.map((f) => {
            const isActive = filterStatus === f.value;
            return (
              <Button
                key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`h-11 flex items-center px-3.5 text-[13px] font-medium border rounded-button whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-primary bg-[var(--surface)] border-primary/45'
                    : 'text-ink-muted bg-white border-border hover:bg-surface'
                }`}
              >
                {f.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Main Inventory Content */}
      {filteredDrugs.length === 0 ? (
        <div className="border border-dashed border-border rounded-card-lg p-16 flex flex-col items-center justify-center text-center gap-2 bg-white">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Package className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </div>
          <h3 className="text-[18px] font-medium text-ink">
            {departmentItems.length === 0 ? `No ${department === 'all' ? 'inventory' : department} items yet` : 'No matching items'}
          </h3>
          <p className="text-[14px] text-ink-muted max-w-[380px] leading-relaxed">
            {departmentItems.length === 0
              ? 'Add items individually or import an existing inventory file.'
              : 'Try adjusting your search query or filter selections above.'}
          </p>
          {departmentItems.length === 0 && (
            <div className="flex gap-3 mt-5 flex-wrap justify-center">
              <Button
                onClick={() => router.push('/pharmacy/inventory/import')}
                className="h-12 flex items-center px-6 bg-white text-primary border-[1.5px] border-primary font-medium text-[15px] rounded-button hover:bg-surface transition-colors"
              >
                Bulk import catalogue
              </Button>
              <Button
                onClick={() => setIsAddModalOpen(true)}
                className="h-12 flex items-center px-6 bg-primary text-white font-medium text-[15px] rounded-button hover:bg-[var(--primary-hover)] transition-colors"
              >
                <Plus className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Add medicine
              </Button>
              <Button
                onClick={() => setIsStoreModalOpen(true)}
                className="h-12 flex items-center px-6 bg-ink text-white font-medium text-[15px] rounded-button hover:bg-ink/90 transition-colors"
              >
                <Plus className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Add store item
              </Button>
            </div>
          )}
        </div>
      ) : (
        <InventoryTable
          drugs={filteredDrugs}
          onRefetch={refetch}
          viewMode={viewMode}
        />
      )}

      {/* Add Drug Modal */}
      <AddDrugModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          if (addProductId) router.replace('/pharmacy/inventory');
        }}
        onSuccess={() => {
          refetch();
          setIsAddModalOpen(false);
          if (addProductId) router.replace('/pharmacy/inventory');
        }}
        preselectedProduct={preselectedProduct}
      />
      <AddStoreItemModal
        isOpen={isStoreModalOpen}
        onClose={() => setIsStoreModalOpen(false)}
        onSuccess={() => {
          refetch();
          setIsStoreModalOpen(false);
          setDepartment('store');
        }}
      />
    </div>
  );
}
