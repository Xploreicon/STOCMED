'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardList,
  ClipboardCheck,
  Clock3,
  Home,
  LayoutDashboard,
  MessageCircle,
  Package,
  Settings,
  Upload,
  User,
  Users,
  HandCoins,
  Wallet,
  HeartHandshake,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider';
import type { PharmacyFeatureKey } from '@/lib/pharmacy-features';

interface SidebarProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
  onNavigate?: () => void;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
  feature?: PharmacyFeatureKey;
}

const patientNavItems: NavItem[] = [
  { label: 'Home', icon: Home, href: '/dashboard' },
  { label: 'Chat search', icon: MessageCircle, href: '/chat' },
  { label: 'History', icon: Clock3, href: '/history' },
  { label: 'My holds', icon: ClipboardCheck, href: '/reservations' },
  { label: 'Profile', icon: User, href: '/profile' },
  { label: 'Settings', icon: Settings, href: '/settings' },
];

const pharmacyNavItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/pharmacy/dashboard' },
  { label: 'Inventory', icon: Boxes, href: '/pharmacy/inventory' },
  { label: 'Import', icon: Upload, href: '/pharmacy/inventory/import' },
  { label: 'Procurement', icon: ClipboardList, href: '/pharmacy/procurement', feature: 'purchase_orders_and_receiving' },
  { label: 'POS', icon: Calculator, href: '/pharmacy/pos' },
  { label: 'Customers', icon: Users, href: '/pharmacy/customers', feature: 'customers' },
  { label: 'Credit', icon: HandCoins, href: '/pharmacy/credit', feature: 'credit_sales' },
  { label: 'Staff', icon: User, href: '/pharmacy/staff', feature: 'staff_accounts' },
  { label: 'Loyalty', icon: HeartHandshake, href: '/pharmacy/loyalty', feature: 'loyalty' },
  { label: 'Reservations', icon: ClipboardCheck, href: '/pharmacy/reservations', feature: 'reservations' },
  { label: 'Shifts', icon: Wallet, href: '/pharmacy/shifts' },
  { label: 'Reports', icon: BarChart3, href: '/pharmacy/reports' },
  { label: 'Settings', icon: Settings, href: '/pharmacy/settings' },
];

export const Sidebar: React.FC<SidebarProps> = ({ userType, className, onNavigate }) => {
  const pathname = usePathname();
  const { isEnabled } = usePharmacyFeatures();
  const navItems = (userType === 'patient' ? patientNavItems : pharmacyNavItems)
    .filter(item => userType === 'patient' || !item.feature || isEnabled(item.feature));

  return (
    <aside
      className={cn(
        'w-60 flex-shrink-0 border-r border-border bg-white px-4 py-6 flex flex-col gap-1',
        className
      )}
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3.5 py-3 rounded-button text-[15px] transition-colors',
              isActive
                ? 'bg-surface text-primary font-medium'
                : 'text-ink-muted hover:bg-surface hover:text-ink'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </aside>
  );
};
