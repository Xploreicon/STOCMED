'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

export default function ReactQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      if (process.env.NODE_ENV !== 'production') {
        const cleanupDevServiceWorker = async () => {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));

          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((key) => key.startsWith('stocmed-'))
                .map((key) => caches.delete(key))
            );
          }

          // Unregistering does not release a page that is already controlled.
          // Reload once after cleanup so the next navigation bypasses the old worker.
          const reloadKey = 'stocmed-dev-sw-cleanup-reload';
          if (navigator.serviceWorker.controller) {
            if (sessionStorage.getItem(reloadKey) !== 'true') {
              sessionStorage.setItem(reloadKey, 'true');
              window.location.reload();
            }
          } else {
            sessionStorage.removeItem(reloadKey);
          }
        };

        void cleanupDevServiceWorker().catch((error) => {
          console.warn('Failed to clean up the development service worker:', error);
        });
        return;
      }
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('PWA ServiceWorker registered with scope:', reg.scope))
        .catch((err) => console.error('PWA ServiceWorker registration failed:', err));
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
