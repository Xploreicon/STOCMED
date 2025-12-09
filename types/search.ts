export interface SearchHistory {
  id: string;
  drug_name: string;
  location: string;
  results_count: number;
  search_date: Date;
  query?: string;
}

export interface SearchStore {
  searches: SearchHistory[];
  addSearch: (search: Omit<SearchHistory, 'id' | 'search_date'>) => void;
  getRecentSearches: (limit?: number) => SearchHistory[];
  clearSearches: () => void;
}
