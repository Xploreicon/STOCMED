'use client';

import { Button } from '@/components/ui/button'

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser } from '@/hooks/useUser';
import { useAuth } from '@/hooks/useAuth';
import { Logo } from '@/components/brand/Logo';
import { NotificationInbox } from '@/components/notifications/NotificationInbox';
import { pageTitle } from '@/lib/navigation';

interface NavbarProps {
  onMenuClick?: () => void;
  menuOpen?: boolean;
}

function initialsFrom(nameOrEmail?: string | null) {
  if (!nameOrEmail) return 'ST';
  const base = nameOrEmail.split('@')[0];
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

export const PatientNavbar: React.FC<NavbarProps> = ({ onMenuClick, menuOpen }) => {
  const router = useRouter();
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const { user } = useUser();
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  const displayName = profile?.full_name;
  const initials = initialsFrom(displayName || user?.email);

  return (
    <header className="relative z-30 shrink-0 bg-white border-b border-border lg:rounded-card lg:border lg:mx-6 lg:mt-5">
      <div className="px-4 sm:px-6">
        <div className="flex min-h-[72px] justify-between items-center gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={onMenuClick} aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="app-mobile-navigation" className="lg:hidden">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="hidden truncate text-xl font-semibold text-ink sm:block">{pageTitle(pathname)}</span>
            <div className="sm:hidden [&_span]:hidden min-[360px]:[&_span]:inline"><Logo size={30} wordSize={17} href="/dashboard" /></div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {user && <NotificationInbox userId={user.id} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 min-h-11 gap-2 rounded-full px-1.5 text-primary hover:bg-secondary"
                  aria-label="Account menu"
                >
                  <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-sm font-semibold">{initials}</span>
                  <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => router.push('/reservations')}>My reservations</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/profile')}>Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/settings')}>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-danger">
                  <LogOut className="h-4 w-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
};
