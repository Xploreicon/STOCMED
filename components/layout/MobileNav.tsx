'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
}

interface NavItem {
  label: string;
  emoji: string;
  href: string;
}

const patientNavItems: NavItem[] = [
  { label: 'Home', emoji: '🏠', href: '/dashboard' },
  { label: 'Chat', emoji: '💬', href: '/chat' },
  { label: 'History', emoji: '🕒', href: '/history' },
  { label: 'Settings', emoji: '⚙️', href: '/settings' },
];

const pharmacyNavItems: NavItem[] = [
  { label: 'Dashboard', emoji: '📊', href: '/pharmacy/dashboard' },
  { label: 'Inventory', emoji: '📦', href: '/pharmacy/inventory' },
  { label: 'Reservations', emoji: '🔔', href: '/pharmacy/reservations' },
  { label: 'Settings', emoji: '⚙️', href: '/pharmacy/settings' },
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
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center gap-1 px-4 py-1.5 min-w-[64px] transition-colors',
              isActive ? 'text-primary' : 'text-ink-muted hover:text-ink'
            )}
          >
            <span className="text-xl flex-shrink-0">{item.emoji}</span>
            <span className={cn('text-[11px]', isActive ? 'font-medium' : 'font-normal')}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

