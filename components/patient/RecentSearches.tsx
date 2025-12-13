'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';

interface SearchRecord {
  id: string;
  query: string;
  displayName?: string;
  location?: string | null;
  timestamp: string;
}

interface RecentSearchesProps {
  searches: SearchRecord[];
}

type SearchRow = {
  id: string;
  query_text: string | null;
  location: string | null;
  timestamp: string;
  metadata: Record<string, unknown> | null;
};

export default function RecentSearches({ searches }: RecentSearchesProps) {
  const router = useRouter();
  const [recentSearches, setRecentSearches] = useState<SearchRecord[]>(searches);
  const [isLoading, setIsLoading] = useState(searches.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setRecentSearches(searches);
    if (searches.length > 0) {
      setIsLoading(false);
      setLoadError(null);
    }
  }, [searches]);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    const loadSearches = async () => {
      try {
        setIsLoading(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (isMounted) {
            setRecentSearches([]);
            setIsLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('searches')
          .select('id, query_text, location, timestamp, metadata')
          .eq('user_id', user.id)
          .order('timestamp', { ascending: false })
          .limit(5);

        if (error) {
          throw error;
        }

        const mapped: SearchRecord[] = ((data ?? []) as SearchRow[]).map((search) => {
          let displayName = '';
          if (search.metadata && typeof search.metadata === 'object') {
            const metadata = search.metadata as { drug_name?: string; query?: string };
            displayName = metadata.drug_name ?? metadata.query ?? '';
          }

          if (!displayName) {
            displayName = search.query_text ?? '';
          }

          return {
            id: search.id,
            query: search.query_text ?? '',
            displayName,
            location: search.location,
            timestamp: search.timestamp,
          };
        });

        if (isMounted) {
          setRecentSearches(mapped);
          setLoadError(null);
        }
      } catch (error) {
        console.error('Failed to load recent searches:', error);
        if (isMounted) {
          setLoadError('Unable to load recent searches right now.');
          setRecentSearches([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    if (searches.length === 0) {
      loadSearches();
    } else {
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [searches]);

  const visibleSearches = useMemo(() => recentSearches.slice(0, 5), [recentSearches]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
        <Search className="mx-auto mb-4 h-12 w-12 animate-pulse text-gray-300" />
        <h3 className="mb-2 text-lg font-semibold text-gray-800">Loading your recent searches...</h3>
        <p className="text-sm text-gray-500">Hang tight while we gather your latest activity.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-dashed border-red-200 bg-white px-6 py-10 text-center">
        <Search className="mx-auto mb-4 h-12 w-12 text-red-300" />
        <h3 className="mb-2 text-lg font-semibold text-gray-800">We hit a snag</h3>
        <p className="mb-6 text-sm text-gray-500">{loadError}</p>
        <Button onClick={() => router.refresh()}>Try Again</Button>
      </div>
    );
  }

  if (visibleSearches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
        <Search className="mx-auto mb-4 h-12 w-12 text-gray-300" />
        <h3 className="mb-2 text-lg font-semibold text-gray-800">No recent searches yet</h3>
        <p className="mb-6 text-sm text-gray-500">
          Start exploring medications to see your search history here.
        </p>
        <Button onClick={() => router.push('/chat')}>Start Your First Search</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleSearches.map((search) => (
        <div
          key={search.id}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 transition hover:border-primary-blue hover:bg-blue-50"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-blue-100 p-2">
                <Search className="h-4 w-4 text-primary-blue" />
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {search.displayName || search.query || 'Unknown medication'}
                </p>
                {search.query && search.query !== search.displayName && (
                  <p className="text-xs text-gray-500">Search term: {search.query}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pl-[2.75rem] text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatDistanceToNow(new Date(search.timestamp), { addSuffix: true })}
              </span>
              {search.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {search.location}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!search.query && !search.displayName}
            onClick={() => {
              const searchTerm = search.query || search.displayName || '';
              router.push(`/chat?q=${encodeURIComponent(searchTerm)}`);
            }}
          >
            Search Again
          </Button>
        </div>
      ))}
    </div>
  );
}
