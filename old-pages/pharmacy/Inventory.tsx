import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { InventoryTable } from '@/components/pharmacy/InventoryTable'
import { DrugCard } from '@/components/pharmacy/DrugCard'
import type { Drug } from '@/types/drug'

// Mock data with Nigerian drug brands
const mockDrugs: Drug[] = [
  {
    id: 1,
    name: 'Emzor Paracetamol',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '500mg',
    price: 500,
    stock: 150
  },
  {
    id: 2,
    name: 'Fidson Amoxicillin',
    category: 'Antibiotics',
    form: 'Capsule',
    strength: '500mg',
    price: 1200,
    stock: 45
  },
  {
    id: 3,
    name: 'GSK Augmentin',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '625mg',
    price: 2500,
    stock: 8
  },
  {
    id: 4,
    name: 'Emzor Artesunate',
    category: 'Antimalarials',
    form: 'Tablet',
    strength: '50mg',
    price: 800,
    stock: 200
  },
  {
    id: 5,
    name: 'Fidson Ibuprofen',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '400mg',
    price: 600,
    stock: 12
  },
  {
    id: 6,
    name: 'GSK Vitamin C',
    category: 'Vitamins',
    form: 'Tablet',
    strength: '1000mg',
    price: 1500,
    stock: 0
  },
  {
    id: 7,
    name: 'Emzor Multivitamin',
    category: 'Vitamins',
    form: 'Capsule',
    strength: 'Complex',
    price: 2000,
    stock: 75
  },
  {
    id: 8,
    name: 'Fidson Ciprofloxacin',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '500mg',
    price: 1800,
    stock: 18
  },
  {
    id: 9,
    name: 'GSK Omeprazole',
    category: 'Gastrointestinal',
    form: 'Capsule',
    strength: '20mg',
    price: 1200,
    stock: 3
  },
  {
    id: 10,
    name: 'Emzor Metronidazole',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '400mg',
    price: 700,
    stock: 90
  },
  {
    id: 11,
    name: 'Fidson Coartem',
    category: 'Antimalarials',
    form: 'Tablet',
    strength: '80/480mg',
    price: 1500,
    stock: 120
  },
  {
    id: 12,
    name: 'GSK Flagyl',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '500mg',
    price: 1300,
    stock: 25
  },
  {
    id: 13,
    name: 'Emzor Buscopan',
    category: 'Gastrointestinal',
    form: 'Tablet',
    strength: '10mg',
    price: 900,
    stock: 6
  },
  {
    id: 14,
    name: 'Fidson Vitamin B Complex',
    category: 'Vitamins',
    form: 'Tablet',
    strength: 'Complex',
    price: 1100,
    stock: 55
  },
  {
    id: 15,
    name: 'GSK Panadol Extra',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '500mg',
    price: 800,
    stock: 180
  }
]

const ITEMS_PER_PAGE = 10

export default function Inventory() {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)

  // Filter drugs based on search and filters
  const filteredDrugs = mockDrugs.filter((drug) => {
    const matchesSearch = drug.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         drug.category.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory = categoryFilter === 'all' || drug.category === categoryFilter

    let matchesStock = true
    if (stockFilter === 'in-stock') {
      matchesStock = drug.stock > 20
    } else if (stockFilter === 'low-stock') {
      matchesStock = drug.stock >= 5 && drug.stock <= 20
    } else if (stockFilter === 'out-of-stock') {
      matchesStock = drug.stock === 0
    }

    return matchesSearch && matchesCategory && matchesStock
  })

  // Pagination
  const totalPages = Math.ceil(filteredDrugs.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedDrugs = filteredDrugs.slice(startIndex, endIndex)
  const totalItems = filteredDrugs.length

  // Reset to page 1 when filters change
  const handleFilterChange = () => {
    setCurrentPage(1)
  }

  const handleEdit = (drug: Drug) => {
    console.log('Edit drug:', drug)
    // TODO: Implement edit functionality
  }

  const handleDelete = (drug: Drug) => {
    console.log('Delete drug:', drug)
    // TODO: Implement delete functionality
  }

  const handleAddDrug = () => {
    console.log('Add new drug')
    // TODO: Implement add drug functionality
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
        </div>

        {/* Filters and Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <Input
                type="text"
                placeholder="Search drugs..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  handleFilterChange()
                }}
              />
            </div>

            {/* Category Filter */}
            <div>
              <Select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value)
                  handleFilterChange()
                }}
              >
                <option value="all">All Categories</option>
                <option value="Analgesics">Analgesics</option>
                <option value="Antibiotics">Antibiotics</option>
                <option value="Antimalarials">Antimalarials</option>
                <option value="Vitamins">Vitamins</option>
                <option value="Gastrointestinal">Gastrointestinal</option>
              </Select>
            </div>

            {/* Stock Status Filter */}
            <div>
              <Select
                value={stockFilter}
                onChange={(e) => {
                  setStockFilter(e.target.value)
                  handleFilterChange()
                }}
              >
                <option value="all">All Stock Status</option>
                <option value="in-stock">In Stock (&gt; 20)</option>
                <option value="low-stock">Low Stock (5-20)</option>
                <option value="out-of-stock">Out of Stock (0)</option>
              </Select>
            </div>
          </div>

          {/* Add Drug Button */}
          <div className="mt-4 flex justify-end">
            <Button onClick={handleAddDrug}>
              <Plus className="w-4 h-4 mr-2" />
              Add Drug
            </Button>
          </div>
        </div>

        {/* Table View (Desktop) */}
        <div className="hidden md:block">
          <InventoryTable
            drugs={paginatedDrugs}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>

        {/* Card View (Mobile) */}
        <div className="md:hidden space-y-4">
          {paginatedDrugs.map((drug) => (
            <DrugCard
              key={drug.id}
              drug={drug}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {/* Pagination */}
        {totalItems > 0 && (
          <div className="mt-6 flex items-center justify-between bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-700">
              Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <div className="flex items-center gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    variant={currentPage === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className="min-w-[40px]"
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {totalItems === 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-lg">No drugs found matching your criteria.</p>
            <p className="text-gray-400 text-sm mt-2">Try adjusting your filters or search query.</p>
          </div>
        )}
      </div>
    </div>
  )
}
