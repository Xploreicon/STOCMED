export interface Drug {
  id: string | number
  name: string
  category: string
  form: string
  strength: string
  price: number
  stock: number
  manufacturer?: string
}

export interface Pharmacy {
  id: string
  name: string
  address: string
  phone: string
  location: string
  distance?: string
  rating?: number
  isOpen?: boolean
}

export interface DrugAvailability {
  id: string
  drug: Drug
  pharmacy: Pharmacy
  price: number
  stockStatus: string
  quantity?: number
  lastUpdated?: Date
}

export interface SearchResult {
  results: DrugAvailability[]
  query: string
  location: string
  totalResults: number
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}
