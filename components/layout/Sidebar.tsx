'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface SidebarProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
  onNavigate?: () => void;
}

interface NavItem {
  label: string;
  emoji: string;
  href: string;
}

const patientNavItems: NavItem[] = [
  { label: 'Home', emoji: '🏠', href: '/dashboard' },
  { label: 'Chat search', emoji: '💬', href: '/chat' },
  { label: 'History', emoji: '🕒', href: '/history' },
  { label: 'Settings', emoji: '⚙️', href: '/settings' },
];

const pharmacyNavItems: NavItem[] = [
  { label: 'Dashboard', emoji: '📊', href: '/pharmacy/dashboard' },
  { label: 'Inventory', emoji: '📦', href: '/pharmacy/inventory' },
  { label: 'Procurement', emoji: '🚚', href: '/pharmacy/procurement' },
  { label: 'POS', emoji: '🧾', href: '/pharmacy/pos' },
  { label: 'Shifts', emoji: '💵', href: '/pharmacy/shifts' },
  { label: 'Reports', emoji: '📈', href: '/pharmacy/reports' },
  { label: 'Reservations', emoji: '🔔', href: '/pharmacy/reservations' },
  { label: 'Settings', emoji: '⚙️', href: '/pharmacy/settings' },
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
            <span className="text-lg flex-shrink-0">{item.emoji}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </aside>
  );
};
