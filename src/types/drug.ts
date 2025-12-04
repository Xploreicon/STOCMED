export interface Pharmacy {
  id: string;
  name: string;
  address: string;
  phone: string;
  location: string;
  distance?: string;
  rating?: number;
  isOpen?: boolean;
}

export interface Drug {
  id: string;
  name: string;
  strength: string;
  form: string; // tablet, capsule, syrup, etc.
  manufacturer?: string;
  description?: string;
}

export interface DrugAvailability {
  id: string;
  drug: Drug;
  pharmacy: Pharmacy;
  price: number;
  stockStatus: 'in-stock' | 'low-stock' | 'out-of-stock';
  quantity?: number;
  lastUpdated?: Date;
}

export interface SearchResult {
  results: DrugAvailability[];
  query: string;
  location?: string;
  totalResults: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  searchResults?: SearchResult;
}
