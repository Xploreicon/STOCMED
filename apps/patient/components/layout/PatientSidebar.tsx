'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardCheck, Clock3, Home, MessageCircle, Settings, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';
import { useUser } from '@/hooks/useUser';
import { navigationItemIsActive } from '@/lib/navigation';

interface SidebarProps {
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


export const PatientSidebar: React.FC<SidebarProps> = ({ className, onNavigate }) => {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const { user } = useUser();
  const navItems = patientNavItems;

  return (
    <aside
      className={cn(
        'w-60 flex-shrink-0 border-r border-border bg-white p-4 flex flex-col',
        className
      )}
    >
      <div className="flex h-[60px] shrink-0 items-center px-3 mb-5">
        <Logo size={34} wordSize={21} href="/dashboard" />
      </div>
      <nav aria-label="Patient navigation" className="flex-1 min-h-0 overflow-y-auto space-y-1">
      {navItems.map((item) => {
        const isActive = navigationItemIsActive(pathname, item.href, navItems.map(nav => nav.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex min-h-11 items-center gap-3 px-3.5 py-3 rounded-button text-sm transition-colors',
              isActive
                ? 'bg-secondary text-primary font-semibold'
                : 'text-ink-muted hover:bg-surface hover:text-ink'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      </nav>
      {user && <div className="mt-4 flex shrink-0 items-center gap-3 border-t border-border px-3 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">{(user.full_name || user.email || 'ST').slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{user.full_name || 'My account'}</p><p className="truncate text-xs text-ink-muted">{user.email}</p></div>
      </div>}
    </aside>
  );
};
