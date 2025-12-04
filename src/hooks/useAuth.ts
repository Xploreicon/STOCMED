import { useAuthStore } from '../store/authStore';
import type { LoginRequest, RegisterRequest } from '../types/auth';

export const useAuth = () => {
  const {
    user,
    pharmacy,
    token,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
    setUser,
  } = useAuthStore();

  // Derived state
  const isPatient = user?.role === 'patient';
  const isPharmacy = user?.role === 'pharmacy';

  return {
    // State
    user,
    pharmacy,
    token,
    isAuthenticated,
    isLoading,

    // Derived state
    isPatient,
    isPharmacy,

    // Actions
    login: async (credentials: LoginRequest) => {
      await login(credentials);
    },
    register: async (data: RegisterRequest) => {
      await register(data);
    },
    logout,
    setUser,
  };
};
