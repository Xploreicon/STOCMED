'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { registerAccountCache } from '@/lib/auth/account-cache';

export default function ReactQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
  }));
  useEffect(() => registerAccountCache(() => client.clear()), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
