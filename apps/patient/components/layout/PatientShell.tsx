'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PatientNavbar } from './PatientNavbar';
import { PatientSidebar } from './PatientSidebar';
import { PatientMobileNav } from './PatientMobileNav';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export function PatientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const { user } = useAuth();
  const isChat = pathname === '/chat';
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname, user?.id]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]') || []).filter(item => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [menuOpen]);

  return (
    <div key={user?.id ?? 'signed-out'} className="h-[100dvh] flex bg-surface text-ink overflow-hidden">
      <a href="#app-main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3">Skip to content</a>
      <div className="hidden lg:flex flex-shrink-0">
        <PatientSidebar className="h-full" />
      </div>
      <div className="flex flex-1 min-w-0 min-h-0 flex-col">
      <PatientNavbar onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />

      <div className="flex-1 flex w-full min-h-0">
        {/* Main content */}
        <main
          id="app-main-content"
          tabIndex={-1}
          className={cn(
            'flex-1 min-w-0 min-h-0 flex flex-col',
            isChat
              ? 'p-0 pb-[76px] lg:pb-0'
              : 'px-4 sm:px-6 py-6 pb-24 lg:pb-8 overflow-y-auto'
          )}
        >
          {children}
        </main>
      </div>

      </div>
      {menuOpen && <div className="fixed inset-0 z-[80] flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" id="app-mobile-navigation">
        <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
        <div ref={drawerRef} className="relative h-full max-w-[85vw] bg-white shadow-xl">
          <Button type="button" variant="ghost" size="icon" className="absolute top-4 right-2 z-10" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X className="h-5 w-5" /></Button>
          <PatientSidebar className="h-full w-72 max-w-[85vw]" onNavigate={() => setMenuOpen(false)} />
        </div>
      </div>}

      <PatientMobileNav />
    </div>
  );
};
