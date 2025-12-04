import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Package,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  Eye,
  Clock
} from 'lucide-react'

// Mock data
const mockStats = {
  total: 45,
  inStock: 38,
  lowStock: 5,
  outOfStock: 2
}

const mockRecentActivity = [
  { id: 1, text: 'Paracetamol viewed 12 times today', time: 'Today', icon: Eye },
  { id: 2, text: 'Amoxicillin stock updated 2 hours ago', time: '2h ago', icon: RefreshCw },
  { id: 3, text: '3 new searches for Malaria medication', time: '4h ago', icon: Eye },
  { id: 4, text: 'Ibuprofen stock level changed', time: '5h ago', icon: Package },
  { id: 5, text: 'Aspirin restocked', time: 'Yesterday', icon: CheckCircle }
]

interface StatCardProps {
  title: string
  value: number
  icon: React.ElementType
  colorClass: string
  bgColorClass: string
  onClick?: () => void
  clickable?: boolean
}

function StatCard({ title, value, icon: Icon, colorClass, bgColorClass, onClick, clickable }: StatCardProps) {
  return (
    <Card
      className={`${clickable ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className={`text-3xl font-bold mt-2 ${colorClass}`}>{value}</p>
          </div>
          <div className={`${bgColorClass} p-3 rounded-full`}>
            <Icon className={`w-6 h-6 ${colorClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()

  const handleLowStockClick = () => {
    navigate('/pharmacy/inventory?filter=low-stock')
  }

  const handleAddNewDrug = () => {
    navigate('/pharmacy/inventory?action=add')
  }

  const handleUpdateStock = () => {
    // Could open a modal or navigate to update page
    console.log('Update stock clicked')
  }

  const handleViewLowStock = () => {
    navigate('/pharmacy/inventory?filter=low-stock')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Pharmacy Dashboard</h1>
          <p className="mt-2 text-gray-600">Monitor and manage your pharmacy inventory</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Drugs"
            value={mockStats.total}
            icon={Package}
            colorClass="text-blue-600"
            bgColorClass="bg-blue-100"
          />
          <StatCard
            title="In Stock"
            value={mockStats.inStock}
            icon={CheckCircle}
            colorClass="text-green-600"
            bgColorClass="bg-green-100"
          />
          <StatCard
            title="Low Stock"
            value={mockStats.lowStock}
            icon={AlertTriangle}
            colorClass="text-orange-600"
            bgColorClass="bg-orange-100"
            onClick={handleLowStockClick}
            clickable={true}
          />
          <StatCard
            title="Out of Stock"
            value={mockStats.outOfStock}
            icon={XCircle}
            colorClass="text-red-600"
            bgColorClass="bg-red-100"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full justify-start"
                  onClick={handleAddNewDrug}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add New Drug
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={handleUpdateStock}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Update Stock
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={handleViewLowStock}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View Low Stock Items
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockRecentActivity.map((activity) => {
                    const ActivityIcon = activity.icon
                    return (
                      <div
                        key={activity.id}
                        className="flex items-start space-x-3 pb-4 border-b border-gray-100 last:border-b-0 last:pb-0"
                      >
                        <div className="bg-gray-100 p-2 rounded-full">
                          <ActivityIcon className="w-4 h-4 text-gray-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-900">{activity.text}</p>
                          <div className="flex items-center mt-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3 mr-1" />
                            {activity.time}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
