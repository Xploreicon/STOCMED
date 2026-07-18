'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { AlertTriangle, BarChart3, Boxes, CheckCircle2, Loader2, Tags, Upload, XCircle, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ReorderSuggestions } from '@/components/pharmacy/ReorderSuggestions';

interface PharmacyStats {
  total: number;
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
}

interface PharmacyStatsResponse {
  stats: PharmacyStats;
  drugs: any[];
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function PharmacyDashboard() {
  const router = useRouter();
  const { user, isLoading: authLoading, isPharmacy } = useUser();

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/dashboard');
    }
  }, [user, authLoading, isPharmacy, router]);

  const { data: statsResponse, isLoading } = useQuery<PharmacyStatsResponse>({
    queryKey: ['pharmacy-stats'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/drugs');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    enabled: !!user && isPharmacy,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/profile');
      if (!response.ok) throw new Error('Failed to fetch pharmacy profile');
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  if (authLoading || isLoading || isProfileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const pharmacyName = profile?.pharmacy_name || 'there';
  const firstName = pharmacyName.split(' ')[0];
  const drugs = statsResponse?.drugs || [];
  const total = drugs.length;

  const today = new Date();
  const ninetyDaysFromNow = new Date();
  ninetyDaysFromNow.setDate(today.getDate() + 90);

  const inStock = drugs.filter((d: any) => d.quantity_in_stock > (d.low_stock_threshold || 10)).length;
  const lowStock = drugs.filter((d: any) => d.quantity_in_stock > 0 && d.quantity_in_stock <= (d.low_stock_threshold || 10)).length;
  const outOfStock = drugs.filter((d: any) => d.quantity_in_stock === 0).length;

  const pct = total ? Math.round((inStock / total) * 100) : 0;

  const stats: Array<{ label: string; value: number; sub: string; icon: LucideIcon; valueColor: string }> = [
    { label: 'Total products', value: total, sub: 'across catalogue', icon: Boxes, valueColor: 'var(--navy)' },
    { label: 'In stock', value: inStock, sub: `${pct}% of catalogue`, icon: CheckCircle2, valueColor: 'var(--success)' },
    { label: 'Low stock', value: lowStock, sub: 'reorder suggested', icon: AlertTriangle, valueColor: 'var(--warning)' },
    { label: 'Out of stock', value: outOfStock, sub: 'restock needed', icon: XCircle, valueColor: 'var(--danger)' },
  ];

  const actions = [
    { icon: Upload, title: 'Update stock levels', sub: 'Bulk edit or CSV upload', href: '/pharmacy/inventory/import' },
    { icon: Tags, title: 'Update prices', sub: 'Manage margins and pricing', href: '/pharmacy/inventory' },
    { icon: BarChart3, title: 'Demand near you', sub: 'What patients searched for', href: '/pharmacy/inventory' }, // links to inventory since insights isn't fully separate
  ];

  const activity = [
    {
      title: 'Low stock alert — Amoxicillin 500mg',
      sub: '8 packs left, searched 22 times this week nearby',
      time: '1 hour ago',
      color: 'var(--warning)',
    },
    {
      title: 'Out of stock — Ventolin inhaler 100mcg',
      sub: '3 patients set restock alerts',
      time: '3 hours ago',
      color: 'var(--danger)',
    },
    {
      title: 'Stock updated — 84 items via CSV',
      sub: 'by Chidi (staff)',
      time: 'Yesterday',
      color: 'var(--success)',
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-[900px] mx-auto py-2">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-medium text-[30px] text-ink leading-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="text-[15px] text-ink-muted mt-2">Here&apos;s how your inventory looks today</p>
        </div>
        <Link
          href="/pharmacy/inventory"
          className="h-12 flex items-center px-6 bg-primary text-white text-[15px] font-medium rounded-button hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap"
        >
          + Add medication
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid min-w-0 grid-cols-2 lg:grid-cols-4 gap-4 mt-7">
        {stats.map((s, idx) => {
          const Icon = s.icon
          return (
            <div key={idx} className="min-w-0 border border-border rounded-card p-4 sm:p-5 bg-white shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="text-[13px] text-ink-light">{s.label}</span>
              </div>
              <div
                style={{ color: s.valueColor }}
                className="text-[30px] font-medium mt-2 tabular-nums"
              >
                {s.value}
              </div>
              <div className="text-[13px] text-ink-muted mt-1 break-words">{s.sub}</div>
            </div>
          )
        })}
      </div>

      <ReorderSuggestions />

      {/* Quick actions */}
      <div className="mt-10">
        <h2 className="text-[16px] font-medium text-ink mb-4">Quick actions</h2>
        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-3 gap-4">
          {actions.map((a) => {
            const Icon = a.icon
            return (
              <Link
                key={a.title}
                href={a.href}
                className="min-w-0 border border-border rounded-card p-5 flex items-center gap-3.5 hover:border-primary/40 hover:bg-surface transition-all bg-white shadow-xs"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink break-words">{a.title}</div>
                  <div className="text-[13px] text-ink-light mt-0.5 break-words">{a.sub}</div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Recent activity */}
      <div className="mt-10 mb-8">
        <h2 className="text-[16px] font-medium text-ink mb-4">Recent activity</h2>
        <div className="border border-border rounded-card bg-white shadow-xs overflow-hidden divide-y divide-border">
          {activity.map((act, idx) => (
            <div key={idx} className="flex items-center justify-between gap-4 p-4 hover:bg-surface transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  style={{ backgroundColor: act.color }}
                  className="w-2 h-2 rounded-full flex-shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink truncate">{act.title}</div>
                  <div className="text-[13px] text-ink-light mt-0.5 truncate">{act.sub}</div>
                </div>
              </div>
              <span className="text-[13px] text-ink-muted whitespace-nowrap flex-shrink-0">
                {act.time}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
