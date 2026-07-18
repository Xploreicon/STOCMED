'use client';

import { Button } from '@/components/ui/button'

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/brand/Logo';

interface NavbarProps {
  pharmacyName?: string;
  userRole?: 'patient' | 'pharmacy';
}

function initialsFrom(nameOrEmail?: string | null) {
  if (!nameOrEmail) return 'ST';
  const base = nameOrEmail.split('@')[0];
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

export const Navbar: React.FC<NavbarProps> = ({ pharmacyName, userRole }) => {
  const router = useRouter();
  const { user, isPatient, isPharmacy } = useUser();
  const resolvedRole = userRole ?? (isPatient ? 'patient' : isPharmacy ? 'pharmacy' : undefined);
  const isPharmacyUI = resolvedRole === 'pharmacy';

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const displayName = isPharmacyUI ? pharmacyName : (user?.user_metadata?.full_name as string | undefined);
  const initials = initialsFrom(displayName || user?.email);

  return (
    <nav className="bg-white border-b border-border sticky top-0 z-50">
      <div className="px-5 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-3.5">
          <Logo size={30} wordSize={17} href="/" />

          <div className="flex items-center gap-4">
            {isPharmacyUI && pharmacyName && (
              <span className="hidden sm:block text-[14px] font-medium text-ink">{pharmacyName}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-[14px] font-medium text-primary hover:bg-primary/5 transition-colors"
                  aria-label="Account menu"
                >
                  {initials}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {isPharmacyUI ? (
                  <>
                    <DropdownMenuItem onClick={() => router.push('/pharmacy/settings')}>Pharmacy settings</DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => router.push('/reservations')}>My reservations</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/profile')}>Profile</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/settings')}>Settings</DropdownMenuItem>
                  </>
                )}
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
    </nav>
  );
};
