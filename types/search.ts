export interface SearchHistory {
  id: string;
  query_text: string;
  location?: string | null;
  results_count: number | null;
  timestamp: Date;
  metadata?: Record<string, unknown> | null;
}

export interface SearchStore {
  searches: SearchHistory[];
  addSearch: (search: Omit<SearchHistory, 'id' | 'timestamp'>) => void;
  getRecentSearches: (limit?: number) => SearchHistory[];
  clearSearches: () => void;
}
