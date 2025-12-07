'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Search,
  Plus,
  Filter,
  Loader2,
  Grid,
  List
} from 'lucide-react';
import InventoryTable from '@/components/pharmacy/InventoryTable';
import AddDrugModal from '@/components/pharmacy/AddDrugModal';

export default function PharmacyInventory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, isPharmacy } = useUser();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>(
    searchParams.get('filter') || 'all'
  );
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/inventory');
    }
  }, [user, authLoading, isPharmacy, router]);

  const { data: drugsData, isLoading, refetch } = useQuery({
    queryKey: ['pharmacy-drugs'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/drugs');
      if (!response.ok) {
        throw new Error('Failed to fetch drugs');
      }
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary-blue" />
          <p className="text-gray-600 text-lg">Loading inventory...</p>
        </div>
      </div>
    );
  }

  // Filter drugs based on search and status
  const filteredDrugs = drugsData?.drugs?.filter((drug: any) => {
    // Search filter
    const matchesSearch = searchQuery
      ? drug.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.generic_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.brand_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        drug.category?.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    // Status filter
    let matchesStatus = true;
    if (filterStatus === 'in_stock') {
      matchesStatus = drug.quantity_in_stock > (drug.low_stock_threshold || 10);
    } else if (filterStatus === 'low_stock') {
      matchesStatus =
        drug.quantity_in_stock > 0 &&
        drug.quantity_in_stock <= (drug.low_stock_threshold || 10);
    } else if (filterStatus === 'out_of_stock') {
      matchesStatus = drug.quantity_in_stock === 0;
    }

    return matchesSearch && matchesStatus;
  }) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Inventory Management
            </h1>
            <p className="text-gray-600 mt-2">
              Manage your pharmacy's drug inventory
            </p>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add New Drug
          </Button>
        </div>

        {/* Search and Filters */}
        <Card className="p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by name, category, or generic name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue"
              >
                <option value="all">All Status</option>
                <option value="in_stock">In Stock</option>
                <option value="low_stock">Low Stock</option>
                <option value="out_of_stock">Out of Stock</option>
              </select>

              {/* View Toggle */}
              <div className="hidden md:flex border border-gray-300 rounded-md">
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-2 ${
                    viewMode === 'table'
                      ? 'bg-primary-blue text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  } rounded-l-md transition-colors`}
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-2 ${
                    viewMode === 'grid'
                      ? 'bg-primary-blue text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  } rounded-r-md transition-colors`}
                >
                  <Grid className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Results Count */}
          <div className="mt-4 text-sm text-gray-600">
            Showing {filteredDrugs.length} of {drugsData?.drugs?.length || 0} drugs
          </div>
        </Card>

        {/* Inventory Content */}
        {filteredDrugs.length === 0 ? (
          <Card className="p-12 text-center">
            <Filter className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {drugsData?.drugs?.length === 0
                ? 'No drugs in inventory'
                : 'No drugs match your filters'}
            </h2>
            <p className="text-gray-600 mb-6">
              {drugsData?.drugs?.length === 0
                ? 'Start adding drugs to your inventory'
                : 'Try adjusting your search or filters'}
            </p>
            {drugsData?.drugs?.length === 0 && (
              <Button onClick={() => setIsAddModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Drug
              </Button>
            )}
          </Card>
        ) : (
          <InventoryTable drugs={filteredDrugs} onRefetch={refetch} />
        )}

        {/* Add Drug Modal */}
        <AddDrugModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            refetch();
            setIsAddModalOpen(false);
          }}
        />
      </div>
    </div>
  );
}
