'use client';

import Link from 'next/link';
import { Clock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface SearchRecord {
  id: string;
  query: string;
  results_count: number;
  created_at: string;
}

interface RecentSearchesProps {
  searches: SearchRecord[];
}

export default function RecentSearches({ searches }: RecentSearchesProps) {
  if (searches.length === 0) {
    return (
      <div className="text-center py-8">
        <Search className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 mb-4">No recent searches</p>
        <Link href="/chat">
          <Button>Start Your First Search</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {searches.map((search) => (
        <Link
          key={search.id}
          href={`/chat?q=${encodeURIComponent(search.query)}`}
          className="block"
        >
          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-primary-blue hover:bg-blue-50 transition-all cursor-pointer group">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 bg-gray-100 rounded-lg group-hover:bg-blue-100 transition-colors">
                <Search className="h-4 w-4 text-gray-600 group-hover:text-primary-blue" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{search.query}</p>
                <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(search.created_at), { addSuffix: true })}
                  </span>
                  <span>{search.results_count} results</span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Search Again
            </Button>
          </div>
        </Link>
      ))}
    </div>
  );
}
