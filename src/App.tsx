import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import Dashboard from '@/pages/patient/Dashboard'
import Chat from '@/pages/patient/Chat'
import History from '@/pages/History'
import PharmacyDashboard from '@/pages/PharmacyDashboard'
import PharmacyInventory from '@/pages/PharmacyInventory'
import PharmacySettings from '@/pages/PharmacySettings'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/history" element={<History />} />
        <Route path="/pharmacy/dashboard" element={<PharmacyDashboard />} />
        <Route path="/pharmacy/inventory" element={<PharmacyInventory />} />
        <Route path="/pharmacy/settings" element={<PharmacySettings />} />
      </Routes>
    </Router>
  )
}

export default App
