import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/store/authStore';
import { Clock, MapPin, Package, Search, Trash2, X } from 'lucide-react';

// Mock data with realistic Nigerian drug names and Lagos locations
const MOCK_SEARCHES = [
  {
    id: '1',
    drug_name: 'Coartem',
    location: 'Ikeja, Lagos',
    results_count: 12,
    search_date: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
  },
  {
    id: '2',
    drug_name: 'Paracetamol 500mg',
    location: 'Victoria Island, Lagos',
    results_count: 18,
    search_date: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
  },
  {
    id: '3',
    drug_name: 'Amoxicillin',
    location: 'Lekki Phase 1, Lagos',
    results_count: 8,
    search_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  },
  {
    id: '4',
    drug_name: 'Lonart DS',
    location: 'Surulere, Lagos',
    results_count: 15,
    search_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
  },
  {
    id: '5',
    drug_name: 'Vitamin C 1000mg',
    location: 'Yaba, Lagos',
    results_count: 22,
    search_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  },
  {
    id: '6',
    drug_name: 'Ibuprofen',
    location: 'Ajah, Lagos',
    results_count: 10,
    search_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
  },
  {
    id: '7',
    drug_name: 'Flagyl',
    location: 'Maryland, Lagos',
    results_count: 14,
    search_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
  },
  {
    id: '8',
    drug_name: 'Ciprofloxacin',
    location: 'Ikoyi, Lagos',
    results_count: 9,
    search_date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000), // 28 days ago
  },
  {
    id: '9',
    drug_name: 'Zinc Tablets',
    location: 'Festac Town, Lagos',
    results_count: 16,
    search_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
  },
  {
    id: '10',
    drug_name: 'M&B',
    location: 'Gbagada, Lagos',
    results_count: 11,
    search_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
  },
];

const LAGOS_LOCATIONS = [
  'All Locations',
  'Ikeja',
  'Victoria Island',
  'Lekki',
  'Surulere',
  'Yaba',
  'Ajah',
  'Maryland',
  'Ikoyi',
  'Festac Town',
  'Gbagada',
];

export default function History() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [timeFilter, setTimeFilter] = useState('last7days');
  const [locationFilter, setLocationFilter] = useState('All Locations');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [searches, setSearches] = useState(MOCK_SEARCHES);

  const formatDate = (date: Date) => {
    const searchDate = new Date(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - searchDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));

    if (diffHours < 1) {
      return 'Just now';
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return searchDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: searchDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    }
  };

  const filterSearches = () => {
    let filtered = [...MOCK_SEARCHES];

    // Filter by time
    const now = new Date();
    if (timeFilter === 'last7days') {
      filtered = filtered.filter((search) => {
        const diffTime = now.getTime() - new Date(search.search_date).getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        return diffDays <= 7;
      });
    } else if (timeFilter === 'last30days') {
      filtered = filtered.filter((search) => {
        const diffTime = now.getTime() - new Date(search.search_date).getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        return diffDays <= 30;
      });
    }

    // Filter by location
    if (locationFilter !== 'All Locations') {
      filtered = filtered.filter((search) =>
        search.location.includes(locationFilter)
      );
    }

    return filtered;
  };

  const handleSearchAgain = (search: typeof MOCK_SEARCHES[0]) => {
    navigate('/chat', { state: { prefillQuery: search.drug_name } });
  };

  const handleClearHistory = () => {
    setSearches([]);
    setShowConfirmDialog(false);
  };

  const filteredSearches = searches.length > 0 ? filterSearches() : [];
  const hasSearches = searches.length > 0;

  return (
    <MainLayout
      authState="patient"
      patientPoints={0}
      onLogout={logout}
    >
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Search History</h1>
          <p className="text-gray-600">
            View and manage your past medication searches
          </p>
        </div>

        {hasSearches && (
          <>
            {/* Filters Row */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  {/* Time Filter */}
                  <div className="w-full sm:w-auto sm:min-w-[180px]">
                    <Select
                      value={timeFilter}
                      onChange={(e) => setTimeFilter(e.target.value)}
                    >
                      <option value="last7days">Last 7 days</option>
                      <option value="last30days">Last 30 days</option>
                      <option value="alltime">All time</option>
                    </Select>
                  </div>

                  {/* Location Filter */}
                  <div className="w-full sm:w-auto sm:min-w-[180px]">
                    <Select
                      value={locationFilter}
                      onChange={(e) => setLocationFilter(e.target.value)}
                    >
                      {LAGOS_LOCATIONS.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/* Clear History Button */}
                  <div className="w-full sm:w-auto sm:ml-auto">
                    <Button
                      variant="outline"
                      onClick={() => setShowConfirmDialog(true)}
                      className="w-full sm:w-auto text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear History
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* History List */}
            {filteredSearches.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSearches.map((search) => (
                  <Card key={search.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-start gap-2">
                        <Package className="w-5 h-5 text-primary-blue flex-shrink-0 mt-0.5" />
                        <span className="font-bold">{search.drug_name}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 flex-shrink-0" />
                          <span>{search.location}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-primary-blue">
                            {search.results_count} results
                          </span>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            <span>{formatDate(search.search_date)}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-primary-blue text-primary-blue hover:bg-primary-blue hover:text-white"
                        onClick={() => handleSearchAgain(search)}
                      >
                        Search Again
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-50 border-dashed">
                <CardContent className="text-center py-12">
                  <div className="mx-auto w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-600 text-lg mb-2">
                    No searches found for the selected filters
                  </p>
                  <p className="text-gray-500 text-sm">
                    Try adjusting your filters or clearing them to see all results
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Empty State - No History */}
        {!hasSearches && (
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="text-center py-16">
              <div className="mx-auto w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-md">
                <Search className="w-10 h-10 text-primary-blue" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                No search history yet
              </h2>
              <p className="text-gray-600 mb-8 max-w-md mx-auto">
                Start searching for medications to see your history here.
              </p>
              <Button
                size="lg"
                onClick={() => navigate('/chat')}
                className="bg-primary-blue text-white hover:bg-blue-700 font-semibold px-8"
              >
                <Search className="w-5 h-5 mr-2" />
                Start Searching
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="text-xl">Clear Search History?</CardTitle>
                <button
                  onClick={() => setShowConfirmDialog(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600">
                This will permanently delete all your search history. This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirmDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleClearHistory}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  Clear History
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </MainLayout>
  );
}
