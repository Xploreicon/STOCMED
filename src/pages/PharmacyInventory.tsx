import { MainLayout } from '@/components/layout/MainLayout'
import { useAuthStore } from '@/store/authStore'

export default function PharmacyInventory() {
  const { pharmacy, logout } = useAuthStore()

  return (
    <MainLayout
      authState="pharmacy"
      pharmacyName={pharmacy?.pharmacy_name || 'Pharmacy'}
      onLogout={logout}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Pharmacy Inventory</h1>
          <p className="mt-2 text-gray-600">Track and manage your medication stock</p>
        </div>
        {/* TODO: Add inventory management features */}
      </div>
    </MainLayout>
  )
}
