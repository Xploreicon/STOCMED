import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SearchHistory, SearchStore } from '../types/search';

export const useSearchStore = create<SearchStore>()(
  persist(
    (set, get) => ({
      searches: [],

      addSearch: (search) => {
        const newSearch: SearchHistory = {
          ...search,
          id: `search-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
        };

        set((state) => ({
          searches: [newSearch, ...state.searches],
        }));
      },

      getRecentSearches: (limit = 3) => {
        return get().searches.slice(0, limit);
      },

      clearSearches: () => {
        set({ searches: [] });
      },
    }),
    {
      name: 'search-storage',
    }
  )
);
