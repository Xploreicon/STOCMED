'use client';

import { Button } from '@/components/ui/button'

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { Loader2, Search, WifiOff, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SearchHistory {
  id: string;
  query_text: string;
  results_count: number | null;
  timestamp: string;
  location?: string | null;
}

type Stock = 'in' | 'low' | 'out';

const FILTERS: { key: 'all' | Stock; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Found in stock' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
];

const BADGE: Record<Stock, { label: string; cls: string }> = {
  in: { label: 'Found in stock', cls: 'badge-success' },
  low: { label: 'Low stock', cls: 'badge-warning' },
  out: { label: 'Out of stock', cls: 'badge-danger' },
};

function stockOf(count: number | null): Stock {
  if (!count || count <= 0) return 'out';
  if (count === 1) return 'low';
  return 'in';
}

export default function History() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();
  const [searches, setSearches] = useState<SearchHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Stock>('all');
  const [query, setQuery] = useState('');

  const fetchHistory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/searches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSearches(await res.json());
    } catch (e) {
      console.error('Error fetching search history:', e);
      setError('Could not load search history. Please check your internet connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirectTo=/history');
    } else if (user) {
      fetchHistory();
    }
  }, [user, authLoading, router]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return searches
      .map((s) => ({ ...s, stock: stockOf(s.results_count) }))
      .filter((s) => filter === 'all' || s.stock === filter)
      .filter((s) => !q || (s.query_text || '').toLowerCase().includes(q));
  }, [searches, filter, query]);

  if (authLoading || isLoading) {
    return (
      <div className="w-full max-w-[760px] mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-72 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="h-12 w-full bg-slate-100 rounded-button animate-pulse" />
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 bg-slate-200 rounded-full animate-pulse" />
          ))}
        </div>
        <div className="border border-border rounded-card divide-y divide-border overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 bg-white flex justify-between items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-56 bg-slate-100 rounded animate-pulse" />
              </div>
              <div className="h-7 w-28 bg-slate-200 rounded-button animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-[760px] mx-auto px-4 py-12 text-center">
        <div className="border border-red-200 bg-red-50/50 rounded-card-lg p-8 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <WifiOff className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-medium text-ink">Connection Failed</h2>
          <p className="text-sm text-ink-muted max-w-md leading-relaxed">{error}</p>
          <Button
            onClick={fetchHistory}
            className="mt-2 inline-flex items-center gap-2 bg-primary text-white text-sm font-medium px-5 py-2.5 rounded-button hover:bg-[var(--primary-hover)] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[760px] mx-auto">
      <h1 className="font-display font-medium text-[30px] text-ink">Search history</h1>
      <p className="text-[15px] text-ink-muted mt-2">Every medication you&apos;ve looked up, and what we found</p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your history…"
        className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white mt-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />

      <div className="flex gap-2 flex-wrap mt-4">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[13px] font-medium px-4 py-2.5 rounded-full whitespace-nowrap border transition-colors ${
                active
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-ink-muted border-border hover:border-primary/40'
              }`}
            >
              {f.label}
            </Button>
          );
        })}
      </div>

      {items.length > 0 ? (
        <div className="border border-border rounded-card overflow-hidden divide-y divide-border mt-6">
          {items.map((it) => {
            const displayText = it.query_text || 'Search';
            const href = `/chat?q=${encodeURIComponent(it.query_text || '')}`;
            return (
              <Link
                key={it.id}
                href={href}
                className="flex items-center justify-between gap-4 p-4 bg-white hover:bg-surface transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink truncate">{displayText}</div>
                  <div className="text-[13px] text-ink-light mt-0.5 truncate">
                  {it.results_count ? `${it.results_count} ${it.results_count === 1 ? 'pharmacy' : 'pharmacies'} found` : 'Nothing nearby'}
                  {it.location ? ` near ${it.location}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3.5 flex-shrink-0">
                <span className={`${BADGE[it.stock].cls} px-2.5 py-1.5 rounded-button whitespace-nowrap`}>{BADGE[it.stock].label}</span>
                <span className="text-[13px] text-ink-light whitespace-nowrap hidden sm:block">
                  {formatDistanceToNow(new Date(it.timestamp), { addSuffix: true })}
                </span>
              </div>
            </Link>
          ); })}
        </div>
      ) : (
        <div className="mt-6 border border-dashed border-border rounded-card-lg px-8 py-16 flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Search className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </div>
          <h3 className="text-[17px] font-medium text-ink">No searches here</h3>
          <p className="text-[14px] text-ink-muted max-w-[320px] leading-[1.55]">
            Nothing in your history matches this filter. Try a different filter, or start a new search.
          </p>
          <Link
            href="/chat"
            className="mt-4 h-12 flex items-center justify-center px-6 bg-primary text-white text-[15px] font-medium rounded-button hover:bg-[var(--primary-hover)]"
          >
            Start a new search
          </Link>
        </div>
      )}
    </div>
  );
}
