'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package,
  PackageCheck,
  PackageMinus,
  PackageX,
  Plus,
  TrendingUp,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import Link from 'next/link';

interface PharmacyStats {
  total: number;
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
  drugs: any[];
}

export default function PharmacyDashboard() {
  const router = useRouter();
  const { user, isLoading: authLoading, isPharmacy } = useUser();

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/dashboard');
    }
  }, [user, authLoading, isPharmacy, router]);

  const { data: stats, isLoading } = useQuery<PharmacyStats>({
    queryKey: ['pharmacy-stats'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/drugs');
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
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
          <p className="text-gray-600 text-lg">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Drugs',
      value: stats?.total || 0,
      icon: Package,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'In Stock',
      value: stats?.in_stock || 0,
      icon: PackageCheck,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Low Stock',
      value: stats?.low_stock || 0,
      icon: PackageMinus,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      title: 'Out of Stock',
      value: stats?.out_of_stock || 0,
      icon: PackageX,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-2">
              Manage your pharmacy inventory and track performance
            </p>
          </div>
          <Button asChild>
            <Link href="/pharmacy/inventory">
              <Plus className="h-4 w-4 mr-2" />
              Add Drug
            </Link>
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      {stat.title}
                    </p>
                    <p className="text-3xl font-bold text-gray-900">
                      {stat.value}
                    </p>
                  </div>
                  <div className={`${stat.bgColor} p-3 rounded-lg`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              asChild
              variant="outline"
              className="h-auto py-4 justify-start"
            >
              <Link href="/pharmacy/inventory">
                <Package className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <p className="font-semibold">View Inventory</p>
                  <p className="text-xs text-gray-500">
                    Manage all your drugs
                  </p>
                </div>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto py-4 justify-start"
            >
              <Link href="/pharmacy/inventory?filter=low_stock">
                <AlertTriangle className="h-5 w-5 mr-3 text-orange-600" />
                <div className="text-left">
                  <p className="font-semibold">Low Stock Alert</p>
                  <p className="text-xs text-gray-500">
                    {stats?.low_stock || 0} items need restocking
                  </p>
                </div>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto py-4 justify-start"
            >
              <Link href="/pharmacy/settings">
                <TrendingUp className="h-5 w-5 mr-3 text-green-600" />
                <div className="text-left">
                  <p className="font-semibold">Pharmacy Settings</p>
                  <p className="text-xs text-gray-500">
                    Update your profile
                  </p>
                </div>
              </Link>
            </Button>
          </div>
        </div>

        {/* Recent Activity */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Recent Activity
          </h2>
          <div className="text-center py-8">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              Activity tracking coming soon
            </p>
            <p className="text-sm text-gray-400 mt-1">
              View recent inventory changes and customer searches
            </p>
          </div>
        </Card>

        {/* Alerts */}
        {stats && stats.low_stock > 0 && (
          <Card className="p-6 mt-6 border-orange-200 bg-orange-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900 mb-1">
                  Low Stock Alert
                </h3>
                <p className="text-sm text-orange-800">
                  You have {stats.low_stock} item{stats.low_stock !== 1 ? 's' : ''} running low on stock.
                  Consider restocking to avoid shortages.
                </p>
                <Button
                  asChild
                  size="sm"
                  className="mt-3 bg-orange-600 hover:bg-orange-700"
                >
                  <Link href="/pharmacy/inventory?filter=low_stock">
                    View Low Stock Items
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        )}

        {stats && stats.out_of_stock > 0 && (
          <Card className="p-6 mt-4 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <PackageX className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 mb-1">
                  Out of Stock Alert
                </h3>
                <p className="text-sm text-red-800">
                  You have {stats.out_of_stock} item{stats.out_of_stock !== 1 ? 's' : ''} out of stock.
                  Restock immediately to continue serving customers.
                </p>
                <Button
                  asChild
                  size="sm"
                  className="mt-3 bg-red-600 hover:bg-red-700"
                >
                  <Link href="/pharmacy/inventory?filter=out_of_stock">
                    View Out of Stock Items
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
