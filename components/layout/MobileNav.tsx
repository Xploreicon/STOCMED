'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardList,
  Clock3,
  Home,
  LayoutDashboard,
  MessageCircle,
  Settings,
  Upload,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
}

const patientNavItems: NavItem[] = [
  { label: 'Home', icon: Home, href: '/dashboard' },
  { label: 'Chat', icon: MessageCircle, href: '/chat' },
  { label: 'History', icon: Clock3, href: '/history' },
  { label: 'Profile', icon: User, href: '/profile' },
  { label: 'Settings', icon: Settings, href: '/settings' },
];

const pharmacyNavItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/pharmacy/dashboard' },
  { label: 'Inventory', icon: Boxes, href: '/pharmacy/inventory' },
  { label: 'Import', icon: Upload, href: '/pharmacy/inventory/import' },
  { label: 'Procure', icon: ClipboardList, href: '/pharmacy/procurement' },
  { label: 'POS', icon: Calculator, href: '/pharmacy/pos' },
  { label: 'Shifts', icon: Wallet, href: '/pharmacy/shifts' },
  { label: 'Reports', icon: BarChart3, href: '/pharmacy/reports' },
];

export const MobileNav: React.FC<MobileNavProps> = ({ userType, className }) => {
  const pathname = usePathname();
  const navItems = userType === 'patient' ? patientNavItems : pharmacyNavItems;

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 bg-white border-t border-border lg:hidden z-50',
        'flex items-center justify-around',
        'pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
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
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1.5 transition-colors',
              isActive ? 'text-primary' : 'text-ink-muted hover:text-ink'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className={cn('max-w-full truncate text-[10px]', isActive ? 'font-medium' : 'font-normal')}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
