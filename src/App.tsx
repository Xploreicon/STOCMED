import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { ProtectedRoute } from '@/components/common/ProtectedRoute'
import { Toaster } from '@/components/common/Toaster'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import Dashboard from '@/pages/patient/Dashboard'
import Chat from '@/pages/patient/Chat'
import History from '@/pages/patient/History'
import PharmacyDashboard from '@/pages/pharmacy/Dashboard'
import PharmacyInventory from '@/pages/PharmacyInventory'
import PharmacySettings from '@/pages/pharmacy/Settings'
import NotFound from '@/pages/NotFound'

// Component to handle landing page redirect
function LandingPage() {
  const { isAuthenticated, user } = useAuthStore()

  if (isAuthenticated && user) {
    const dashboardPath = user.role === 'patient' ? '/dashboard' : '/pharmacy/dashboard'
    return <Navigate to={dashboardPath} replace />
  }

  return <Landing />
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Patient routes - protected */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute role="patient">
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute role="patient">
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute role="patient">
                <History />
              </ProtectedRoute>
            }
          />

          {/* Pharmacy routes - protected */}
          <Route
            path="/pharmacy/dashboard"
            element={
              <ProtectedRoute role="pharmacy">
                <PharmacyDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pharmacy/inventory"
            element={
              <ProtectedRoute role="pharmacy">
                <PharmacyInventory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pharmacy/settings"
            element={
              <ProtectedRoute role="pharmacy">
                <PharmacySettings />
              </ProtectedRoute>
            }
          />

          {/* 404 Not Found - catch all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </Router>
    </ErrorBoundary>
  )
}

export default App
