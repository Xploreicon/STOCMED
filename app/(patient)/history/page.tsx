'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SearchHistory {
  id: string;
  query_text: string;
  results_count: number | null;
  timestamp: string;
  location?: string | null;
  metadata?: any;
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
  const [filter, setFilter] = useState<'all' | Stock>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirectTo=/history');
    } else if (user) {
      (async () => {
        setIsLoading(true);
        try {
          const res = await fetch('/api/searches');
          if (res.ok) setSearches(await res.json());
        } catch (e) {
          console.error('Error fetching search history:', e);
        } finally {
          setIsLoading(false);
        }
      })();
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[13px] font-medium px-4 py-2.5 rounded-full whitespace-nowrap border transition-colors ${
                active
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-ink-muted border-border hover:border-primary/40'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {items.length > 0 ? (
        <div className="border border-border rounded-card overflow-hidden divide-y divide-border mt-6">
          {items.map((it) => {
            const isHashed = it.query_text && it.query_text.startsWith('hash:');
            const displayText = isHashed ? 'Medication Search' : (it.query_text || 'Search');
            const href = isHashed ? '/chat' : `/chat?q=${encodeURIComponent(it.query_text || '')}`;
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
          <div className="w-14 h-14 rounded-card-lg bg-surface flex items-center justify-center text-2xl mb-2">🔍</div>
          <h3 className="text-[17px] font-medium text-ink">No searches here</h3>
          <p className="text-[14px] text-ink-muted max-w-[320px] leading-[1.55]">
            Nothing in your history matches this filter. Try a different filter, or start a new search.
          </p>
          <Link
            href="/chat"
            className="mt-4 h-12 flex items-center justify-center px-6 bg-primary text-white text-[15px] font-medium rounded-button hover:bg-[#0052A3]"
          >
            Start a new search
          </Link>
        </div>
      )}
    </div>
  );
}
