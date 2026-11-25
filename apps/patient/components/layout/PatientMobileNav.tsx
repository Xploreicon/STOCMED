'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, Clock3, Home, MessageCircle, Settings, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigationItemIsActive } from '@/lib/navigation';

interface MobileNavProps {
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
  { label: 'My holds', icon: ClipboardCheck, href: '/reservations' },
  { label: 'Profile', icon: User, href: '/profile' },
  { label: 'Settings', icon: Settings, href: '/settings' },
];


export const PatientMobileNav: React.FC<MobileNavProps> = ({ className }) => {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const navItems = patientNavItems;

  return (
    <nav
      aria-label="Patient mobile navigation"
      className={cn(
        'fixed bottom-0 left-0 right-0 bg-white border-t border-border lg:hidden z-50',
        'flex items-center justify-around',
        'pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        className
      )}
    >
      {navItems.map((item) => {
        const isActive = navigationItemIsActive(pathname, item.href, navItems.map(nav => nav.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.label}
            className={cn(
              'flex min-h-12 min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors',
              isActive ? 'bg-secondary text-primary' : 'text-ink-muted hover:text-ink'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className={cn('max-w-full truncate text-[11px]', isActive ? 'font-semibold' : 'font-medium')}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
