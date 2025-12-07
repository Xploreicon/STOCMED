'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/useUser';
import { Search, Trash2, Calendar, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SearchHistory {
  id: string;
  query: string;
  results_count: number;
  created_at: string;
  metadata?: any;
}

export default function History() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();
  const [searches, setSearches] = useState<SearchHistory[]>([]);
  const [filteredSearches, setFilteredSearches] = useState<SearchHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<'all' | '7days' | '30days' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirectTo=/history');
    } else if (user) {
      fetchSearchHistory();
    }
  }, [user, authLoading, router]);

  const fetchSearchHistory = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/searches');
      if (response.ok) {
        const data = await response.json();
        setSearches(data);
        setFilteredSearches(data);
      }
    } catch (error) {
      console.error('Error fetching search history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    applyFilters();
  }, [dateFilter, startDate, endDate, searchQuery, searches]);

  const applyFilters = () => {
    let filtered = [...searches];

    // Apply date filter
    if (dateFilter === '7days') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      filtered = filtered.filter(
        (search) => new Date(search.created_at) >= sevenDaysAgo
      );
    } else if (dateFilter === '30days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filtered = filtered.filter(
        (search) => new Date(search.created_at) >= thirtyDaysAgo
      );
    } else if (dateFilter === 'custom' && startDate && endDate) {
      filtered = filtered.filter((search) => {
        const searchDate = new Date(search.created_at);
        return searchDate >= new Date(startDate) && searchDate <= new Date(endDate);
      });
    }

    // Apply search query filter
    if (searchQuery.trim()) {
      filtered = filtered.filter((search) =>
        search.query.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredSearches(filtered);
  };

  const handleClearHistory = async () => {
    if (!confirm('Are you sure you want to clear your entire search history? This action cannot be undone.')) {
      return;
    }

    try {
      // Delete all searches for this user
      // Note: This requires a DELETE endpoint in /api/searches
      const deletePromises = searches.map((search) =>
        fetch(`/api/searches/${search.id}`, { method: 'DELETE' })
      );
      await Promise.all(deletePromises);

      setSearches([]);
      setFilteredSearches([]);
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Failed to clear history. Please try again.');
    }
  };

  const handleSearchAgain = (query: string) => {
    router.push(`/chat?q=${encodeURIComponent(query)}`);
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary-blue" />
          <p className="text-gray-600 text-lg">Loading search history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Search History</h1>
          <p className="text-gray-600 mt-2">
            View and manage your medication search history
          </p>
        </div>

        {/* Filters */}
        <Card className="p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search filter */}
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search queries
              </label>
              <Input
                placeholder="Filter by search term..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Date range filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time period
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue"
              >
                <option value="all">All time</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>
            </div>

            {/* Clear history button */}
            <div className="flex items-end">
              <Button
                onClick={handleClearHistory}
                variant="outline"
                className="w-full text-red-600 border-red-300 hover:bg-red-50"
                disabled={searches.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear History
              </Button>
            </div>
          </div>

          {/* Custom date range inputs */}
          {dateFilter === 'custom' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start date
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End date
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </Card>

        {/* Results count */}
        <div className="mb-4">
          <p className="text-gray-600">
            Showing {filteredSearches.length} of {searches.length} searches
          </p>
        </div>

        {/* Search history list */}
        {filteredSearches.length === 0 ? (
          <Card className="p-12 text-center">
            <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {searches.length === 0 ? 'No search history yet' : 'No results found'}
            </h2>
            <p className="text-gray-600 mb-6">
              {searches.length === 0
                ? 'Start searching for medications to build your history'
                : 'Try adjusting your filters'}
            </p>
            {searches.length === 0 && (
              <Button onClick={() => router.push('/chat')}>
                <Search className="h-4 w-4 mr-2" />
                Start Searching
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredSearches.map((search) => (
              <Card
                key={search.id}
                className="p-4 hover:border-primary-blue transition-colors cursor-pointer"
                onClick={() => handleSearchAgain(search.query)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        {search.query}
                      </h3>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 ml-8">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDistanceToNow(new Date(search.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                      <span>
                        {search.results_count} result{search.results_count !== 1 ? 's' : ''}
                      </span>
                      {search.metadata?.clicked_drug_id && (
                        <span className="text-primary-blue font-medium">
                          • Clicked result
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSearchAgain(search.query);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Search Again
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
