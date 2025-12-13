import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, Clock, Pill } from 'lucide-react'
import RecentSearches from '@/components/patient/RecentSearches'
import SearchChips from '@/components/patient/SearchChips'

export default async function PatientDashboard() {
  const supabase = await createClient()

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch user details from users table
  const { data: userData } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', user.id)
    .single()

  // Fetch recent searches
  const { data: recentSearchesData } = await supabase
    .from('searches')
    .select('id, query_text, location, timestamp, metadata')
    .eq('user_id', user.id)
    .order('timestamp', { ascending: false })
    .limit(5)

  type RecentSearchRow = {
    id: string
    query_text: string | null
    location: string | null
    timestamp: string
    metadata: Record<string, unknown> | null
  }

  const recentSearchRows = (recentSearchesData ?? []) as RecentSearchRow[]

  const recentSearches: Array<{
    id: string
    query: string
    displayName: string
    location?: string | null
    timestamp: string
  }> = recentSearchRows.map((search) => {
    let displayName = '';

    if (typeof search.metadata === 'object' && search.metadata !== null) {
      const metadata = search.metadata as { drug_name?: string; query?: string };
      displayName = metadata.drug_name ?? metadata.query ?? '';
    }

    if (!displayName) {
      displayName = search.query_text ?? '';
    }

    return {
      id: search.id,
      query: search.query_text ?? '',
      displayName,
      location: search.location,
      timestamp: search.timestamp,
    };
  })

  const userName = (userData as any)?.full_name || user.email?.split('@')[0] || 'there'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome back, {userName}!
          </h1>
          <p className="text-gray-600 mt-2">
            Find medications quickly with our AI-powered search
          </p>
        </div>

        {/* Main CTA Card */}
        <Card className="mb-8 border-2 border-primary-blue bg-gradient-to-br from-blue-50 to-white">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-3 bg-primary-blue rounded-lg">
                    <Search className="h-6 w-6 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Search for Medications
                  </h2>
                </div>
                <p className="text-gray-600 text-lg">
                  Our AI assistant will help you find medications and pharmacies near you
                </p>
              </div>
              <Link href="/chat">
                <Button
                  size="lg"
                  className="bg-primary-blue hover:bg-blue-700 text-white px-8 py-6 text-lg"
                >
                  Start Search
                  <Search className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Searches */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-gray-600" />
                    <CardTitle>Recent Searches</CardTitle>
                  </div>
                  <Link href="/history">
                    <Button variant="ghost" size="sm">
                      View All
                    </Button>
                  </Link>
                </div>
                <CardDescription>
                  Your recent medication searches
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RecentSearches searches={recentSearches} />
              </CardContent>
            </Card>
          </div>

          {/* Quick Search Suggestions */}
          <div>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Pill className="h-5 w-5 text-gray-600" />
                  <CardTitle>Quick Search</CardTitle>
                </div>
                <CardDescription>
                  Common medications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SearchChips />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <div className="inline-flex p-4 bg-blue-100 rounded-full mb-4">
                  <Search className="h-8 w-8 text-primary-blue" />
                </div>
                <h3 className="font-semibold text-lg mb-2">AI-Powered Search</h3>
                <p className="text-gray-600 text-sm">
                  Describe your needs and let our AI find the right medication
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <div className="inline-flex p-4 bg-green-100 rounded-full mb-4">
                  <Pill className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Real-Time Availability</h3>
                <p className="text-gray-600 text-sm">
                  See which pharmacies have your medication in stock
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <div className="inline-flex p-4 bg-purple-100 rounded-full mb-4">
                  <Clock className="h-8 w-8 text-purple-600" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Save Time</h3>
                <p className="text-gray-600 text-sm">
                  Find medications in minutes, not hours of calling around
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
