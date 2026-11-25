'use client';

import { usePatientFetch } from '@/hooks/usePatientFetch';
import { isPatientAbort } from '@/lib/patient-operation';

import { Button } from '@/components/ui/button'

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { Clock3, Search, WifiOff, RefreshCw, ArrowRight } from 'lucide-react';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { recordedSearchStatus, recordedSearchSummary, repeatSearchHref, type RecordedSearchStatus } from './history-utils';

interface SearchHistory {
  id: string;
  query_text: string;
  results_count: number | null;
  timestamp: string;
  location?: string | null;
}

const FILTERS: { key: 'all' | RecordedSearchStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'found', label: 'Matches found' },
  { key: 'none', label: 'No matches' },
  { key: 'unknown', label: 'Not recorded' },
];

const BADGE: Record<RecordedSearchStatus, { label: string; cls: string }> = {
  found: { label: 'Matches found', cls: 'bg-success/10 text-success' },
  none: { label: 'No matches', cls: 'bg-surface text-ink-muted' },
  unknown: { label: 'Not recorded', cls: 'bg-surface text-ink-muted' },
};

function dateGroup(timestamp: string) {
  const date = new Date(timestamp);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'd MMMM yyyy');
}

export default function History() {
  const nativeFetch = usePatientFetch();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();
  const [searches, setSearches] = useState<SearchHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | RecordedSearchStatus>('all');
  const [query, setQuery] = useState('');

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await nativeFetch('/api/searches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSearches(await res.json());
    } catch (e) {
      if (isPatientAbort(e)) return;
      console.error('Error fetching search history:', e);
      setError('Could not load search history. Please check your internet connection.');
    } finally {
      setIsLoading(false);
    }
  }, [nativeFetch]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirectTo=/history');
    } else if (user) {
      fetchHistory();
    }
  }, [user, authLoading, router, fetchHistory]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return searches
      .map((s) => ({ ...s, status: recordedSearchStatus(s.results_count) }))
      .filter((s) => filter === 'all' || s.status === filter)
      .filter((s) => !q || `${s.query_text || ''} ${s.location || ''}`.toLowerCase().includes(q));
  }, [searches, filter, query]);

  if (authLoading || isLoading) {
    return (
      <div className="w-full max-w-[760px] mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-surface rounded animate-pulse" />
          <div className="h-4 w-72 bg-surface rounded animate-pulse" />
        </div>
        <div className="h-12 w-full bg-surface rounded-button animate-pulse" />
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 bg-surface rounded-full animate-pulse" />
          ))}
        </div>
        <div className="border border-border rounded-card divide-y divide-border overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 bg-white flex justify-between items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 bg-surface rounded animate-pulse" />
                <div className="h-4 w-56 bg-surface rounded animate-pulse" />
              </div>
              <div className="h-7 w-28 bg-surface rounded-button animate-pulse" />
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
    <div className="w-full max-w-[1100px] mx-auto">
      <h1 className="font-display font-semibold text-[25px] sm:text-[30px] text-ink">Search history</h1>
      <p className="text-sm text-ink-muted mt-1.5">Every medication you&apos;ve looked up, and what was available at the time.</p>

      <section className="mt-6 rounded-card border border-border bg-white p-4 sm:p-6" aria-label="Past medicine searches">
      <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <label htmlFor="history-search" className="sr-only">Search history by medicine or area</label>
      <input
        id="history-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by medicine or area…"
        className="w-full h-12 border border-border rounded-button pl-10 pr-4 text-sm text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      </div>

      <div className="flex gap-1 flex-wrap mt-5 rounded-button border border-border p-1 w-fit" aria-label="Filter recorded search results">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Button
              key={f.key}
              variant="ghost"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={`text-xs sm:text-sm font-medium px-3 py-2 rounded-button whitespace-nowrap transition-colors ${
                active
                  ? 'bg-primary text-white hover:bg-primary hover:text-white'
                  : 'bg-white text-ink-muted hover:bg-surface'
              }`}
            >
              {f.label}
            </Button>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-muted">These are recorded results, not live stock levels. Search again to check current availability.</p>

      {items.length > 0 ? (
        <div className="mt-5">
          {items.map((it, index) => {
            const displayText = it.query_text || 'Search';
            const href = repeatSearchHref(it.query_text || '', it.location);
            const group = dateGroup(it.timestamp);
            const showGroup = index === 0 || dateGroup(items[index - 1].timestamp) !== group;
            return (
              <div key={it.id}>
              {showGroup && <h2 className="pt-5 pb-2 text-sm font-semibold text-ink">{group}</h2>}
              <Link
                href={href}
                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 border-b border-border py-4 rounded-button hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex min-w-0 flex-1 gap-3">
                  <Clock3 className="mt-1 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink break-words">{displayText}</div>
                    <p className="text-xs text-ink-muted mt-1 leading-relaxed">{recordedSearchSummary(it.results_count, it.location)}</p>
                    <time dateTime={it.timestamp} className="mt-1 block text-xs text-ink-muted">{formatDistanceToNow(new Date(it.timestamp), { addSuffix: true })}</time>
                  </div>
                </div>
                <div className="ml-8 sm:ml-0 flex items-center gap-3 flex-shrink-0">
                  <span className={`${BADGE[it.status].cls} hidden md:inline-flex px-2.5 py-1.5 text-xs font-medium rounded-button whitespace-nowrap`}>{BADGE[it.status].label}</span>
                  <span className="inline-flex min-h-10 items-center gap-2 rounded-button border border-border px-3 text-xs font-semibold text-primary">Search again <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                </div>
              </Link>
              </div>
          ); })}
        </div>
      ) : (
        <div className="mt-6 border border-dashed border-border rounded-card-lg px-8 py-16 flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Search className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </div>
          <h3 className="text-[17px] font-medium text-ink">{searches.length ? 'No matching searches' : 'No searches yet'}</h3>
          <p className="text-[14px] text-ink-muted max-w-[320px] leading-[1.55]">
            {searches.length ? 'Try another medicine, area or filter, or start a new search.' : 'Medicines you look up will appear here. Start a search to find nearby pharmacies.'}
          </p>
          <Link
            href="/chat"
            className="mt-4 h-12 flex items-center justify-center px-6 bg-primary text-white text-[15px] font-medium rounded-button hover:bg-[var(--primary-hover)]"
          >
            Start a new search
          </Link>
        </div>
      )}
      </section>
    </div>
  );
}
