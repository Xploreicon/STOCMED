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
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
  onNavigate?: () => void;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
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
  { label: 'Procurement', icon: ClipboardList, href: '/pharmacy/procurement' },
  { label: 'POS', icon: Calculator, href: '/pharmacy/pos' },
  { label: 'Reservations', icon: ClipboardCheck, href: '/pharmacy/reservations' },
  { label: 'Shifts', icon: Wallet, href: '/pharmacy/shifts' },
  { label: 'Reports', icon: BarChart3, href: '/pharmacy/reports' },
  { label: 'Settings', icon: Settings, href: '/pharmacy/settings' },
];

export const Sidebar: React.FC<SidebarProps> = ({ userType, className, onNavigate }) => {
  const pathname = usePathname();
  const navItems = userType === 'patient' ? patientNavItems : pharmacyNavItems;

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
