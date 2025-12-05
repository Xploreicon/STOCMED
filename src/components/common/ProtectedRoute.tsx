import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { UserRole } from '@/types/auth';
import { LoadingSpinner } from './LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  role?: UserRole;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  role,
}) => {
  const location = useLocation();
  const { isAuthenticated, user, isLoading } = useAuthStore();

  // Show loading spinner while auth state is being determined
  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If a specific role is required, check if user has that role
  if (role && user.role !== role) {
    // Redirect to the correct dashboard based on user's actual role
    const correctDashboard = user.role === 'patient'
      ? '/dashboard'
      : '/pharmacy/dashboard';

    return <Navigate to={correctDashboard} replace />;
  }

  // User is authenticated and has the correct role (or no role required)
  return <>{children}</>;
};
