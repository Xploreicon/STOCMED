import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Pharmacy, LoginRequest, RegisterRequest } from '../types/auth';
import { mockLogin, mockRegister } from '../services/mockApi';

interface AuthStore {
  user: User | null;
  pharmacy: Pharmacy | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  setUser: (user: User, pharmacy?: Pharmacy, token?: string) => void;
  checkTokenExpiry: () => void;
}

// Helper function to decode JWT and check expiry
const decodeJWT = (token: string): { exp?: number } | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
};

// Helper function to check if token is expired
const isTokenExpired = (token: string): boolean => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  // JWT exp is in seconds, Date.now() is in milliseconds
  const currentTime = Date.now() / 1000;
  return decoded.exp < currentTime;
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      pharmacy: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (credentials: LoginRequest) => {
        set({ isLoading: true });

        try {
          const response = await mockLogin(credentials);
          const { user, pharmacy, token } = response;

          set({
            user,
            pharmacy: pharmacy || null,
            token,
            isAuthenticated: true,
            isLoading: false,
          });

          // Set up auto-logout on token expiry
          get().checkTokenExpiry();
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: RegisterRequest) => {
        set({ isLoading: true });

        try {
          const response = await mockRegister(data);
          const { user, pharmacy, token } = response;

          set({
            user,
            pharmacy: pharmacy || null,
            token,
            isAuthenticated: true,
            isLoading: false,
          });

          // Set up auto-logout on token expiry
          get().checkTokenExpiry();
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: () => {
        set({
          user: null,
          pharmacy: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        });

        // Clear persisted state from localStorage
        localStorage.removeItem('auth-storage');
      },

      setUser: (user: User, pharmacy?: Pharmacy, token?: string) => {
        set({
          user,
          pharmacy: pharmacy || null,
          token: token || get().token,
          isAuthenticated: true,
        });

        // Check token expiry after setting user
        if (token || get().token) {
          get().checkTokenExpiry();
        }
      },

      checkTokenExpiry: () => {
        const { token, logout } = get();

        if (!token) {
          return;
        }

        // Check if token is already expired
        if (isTokenExpired(token)) {
          logout();
          return;
        }

        // Calculate time until expiry and set timeout for auto-logout
        const decoded = decodeJWT(token);
        if (decoded && decoded.exp) {
          const currentTime = Date.now() / 1000;
          const timeUntilExpiry = (decoded.exp - currentTime) * 1000; // Convert to milliseconds

          // Set timeout to logout when token expires
          setTimeout(() => {
            if (get().token === token) { // Only logout if token hasn't changed
              logout();
            }
          }, timeUntilExpiry);
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        pharmacy: state.pharmacy,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Check token expiry on rehydration (page reload)
        if (state) {
          state.checkTokenExpiry();
        }
      },
    }
  )
);
