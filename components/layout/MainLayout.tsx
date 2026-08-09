'use client';

import React from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import IosInstallPrompt from '@/components/patient/IosInstallPrompt';
import { PharmacyReservationsBar } from '@/components/pharmacy/PharmacyReservationsBar';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider';

interface MainLayoutProps {
  children: React.ReactNode;
  role: 'patient' | 'pharmacy';
  initialPharmacyProfile?: { pharmacy_name: string | null; logo_url: string | null } | null;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, role, initialPharmacyProfile }) => {
  const pathname = usePathname();
  const isChat = pathname === '/chat';
  const { isEnabled } = usePharmacyFeatures();

  const { data: pharmacyProfile } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/profile');
      if (!response.ok) {
        throw new Error('Failed to fetch pharmacy profile');
      }
      return response.json();
    },
    enabled: role === 'pharmacy',
    // The server value only contains the two header fields. Keep it as
    // per-observer placeholder data so it cannot seed the shared full-profile
    // cache with a partial object (or null) before Settings loads.
    placeholderData: role === 'pharmacy' ? initialPharmacyProfile : undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  return (
    <div className="h-screen flex flex-col bg-white text-ink overflow-hidden">
      <Navbar
        userRole={role}
        pharmacyName={role === 'pharmacy' ? pharmacyProfile?.pharmacy_name : undefined}
        pharmacyLogoUrl={role === 'pharmacy' ? pharmacyProfile?.logo_url : undefined}
      />

      {role === 'pharmacy' && isEnabled('reservations') && <PharmacyReservationsBar />}

      <div className="flex-1 flex w-full min-h-0">
        {/* Desktop sidebar — hidden on mobile (bottom nav takes over) */}
        <div className="hidden lg:flex flex-shrink-0">
          <Sidebar userType={role} className="h-full" />
        </div>

        {/* Main content */}
        <main
          className={cn(
            'flex-1 min-w-0 min-h-0 flex flex-col',
            isChat
              ? 'p-0 pb-[76px] lg:pb-0'
              : 'px-5 sm:px-6 lg:px-8 py-6 lg:py-10 pb-24 lg:pb-10 overflow-y-auto'
          )}
        >
          {children}
        </main>
      </div>

      {role === 'patient' && <IosInstallPrompt />}
      <MobileNav userType={role} />
    </div>
  );
};
