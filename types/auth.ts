export type UserRole = 'patient' | 'pharmacy';

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: UserRole;
  location: string;
}

export interface Pharmacy {
  id: string;
  pharmacy_name: string;
  license_number: string;
  address: string;
  city: string;
  state: string;
  phone: string;
}

export interface AuthState {
  user: User | null;
  pharmacy: Pharmacy | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: UserRole;
  location: string;
  // Pharmacy-specific fields (optional, required only if role is 'pharmacy')
  pharmacy_name?: string;
  license_number?: string;
  address?: string;
  city?: string;
  state?: string;
}

export interface AuthResponse {
  user: User;
  pharmacy?: Pharmacy;
  token: string;
}
