import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { useSearchStore } from '@/store/searchStore';
import { Search, Clock, MapPin, Package } from 'lucide-react';

const SUGGESTED_SEARCHES = [
  'Paracetamol',
  'Amoxicillin',
  'Ibuprofen',
  'Vitamin C',
  'Malaria drugs',
];

export default function PatientDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { getRecentSearches } = useSearchStore();

  const recentSearches = getRecentSearches(3);
  const hasSearches = recentSearches.length > 0;

  const handleStartChat = () => {
    navigate('/chat');
  };

  const handleSuggestedSearch = (query: string) => {
    navigate('/chat', { state: { prefillQuery: query } });
  };

  const handleSearchAgain = (search: any) => {
    navigate('/chat', { state: { prefillQuery: search.drug_name } });
  };

  const formatDate = (date: Date) => {
    const searchDate = new Date(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - searchDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
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

  return (
    <MainLayout
      authState="patient"
      patientPoints={0}
      onLogout={logout}
    >
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Welcome Message */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">
            Hello, {user?.full_name || 'Patient'}!
          </h1>
          <p className="text-gray-600">
            Find medications near you with our AI-powered search assistant
          </p>
        </div>

        {/* Main CTA Card */}
        <Card className="bg-gradient-to-br from-primary-blue to-blue-600 border-0 shadow-lg">
          <CardHeader className="text-center space-y-4 pb-8">
            <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
              <Search className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl md:text-3xl font-bold text-white">
              What medication are you looking for?
            </CardTitle>
            <CardDescription className="text-blue-100 text-base">
              Get instant results from nearby pharmacies
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-8">
            <Button
              size="lg"
              onClick={handleStartChat}
              className="bg-white text-primary-blue hover:bg-gray-50 font-semibold px-8 py-6 text-lg h-auto shadow-md"
            >
              Start Chat Search
            </Button>
          </CardContent>
        </Card>

        {/* Recent Searches Section */}
        {hasSearches && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-600" />
                Recent Searches
              </h2>
              <Button
                variant="link"
                onClick={() => navigate('/history')}
                className="text-primary-blue"
              >
                View all
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recentSearches.map((search) => (
                <Card key={search.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Package className="w-5 h-5 text-primary-blue" />
                      {search.drug_name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        <span>{search.location}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{search.results_count} results found</span>
                        <span className="text-xs text-gray-500">
                          {formatDate(search.search_date)}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleSearchAgain(search)}
                    >
                      Search Again
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty State for No Searches */}
        {!hasSearches && (
          <Card className="bg-gray-50 border-dashed">
            <CardContent className="text-center py-12">
              <div className="mx-auto w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 text-lg">
                No searches yet. Start by asking our AI assistant!
              </p>
            </CardContent>
          </Card>
        )}

        {/* Suggested Searches Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Suggested Searches
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {SUGGESTED_SEARCHES.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestedSearch(suggestion)}
                className="flex-shrink-0 px-6 py-3 bg-white border-2 border-gray-200 rounded-full text-gray-700 font-medium hover:border-primary-blue hover:text-primary-blue hover:bg-blue-50 transition-all duration-200 whitespace-nowrap shadow-sm"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Additional Info Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-6">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">
                  How it works
                </h3>
                <p className="text-sm text-gray-600">
                  Our AI assistant helps you find medications at nearby pharmacies.
                  Simply describe what you're looking for, and we'll show you available options with prices and locations.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleStartChat}
                className="bg-white border-primary-blue text-primary-blue hover:bg-primary-blue hover:text-white whitespace-nowrap"
              >
                Get Started
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </MainLayout>
  );
}
