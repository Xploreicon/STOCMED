import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Target, Users, Award, Heart } from 'lucide-react'

export default function About() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-3xl">About StocMed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-gray-700">
            <section>
              <p className="text-lg">
                StocMed is an innovative platform connecting patients with pharmacies across Nigeria.
                Using AI-powered search technology, we make it easy to find medications quickly and
                efficiently, ensuring you get the healthcare you need when you need it.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <Target className="h-6 w-6 text-blue-600" />
                Our Mission
              </h2>
              <p>
                To bridge the gap between patients and pharmacies by providing a seamless,
                intelligent platform that makes medication searches faster, easier, and more
                reliable for everyone.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <Heart className="h-6 w-6 text-blue-600" />
                What We Do
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Connect patients with local pharmacies in real-time</li>
                <li>Provide AI-powered medication search and recommendations</li>
                <li>Help pharmacies manage their inventory efficiently</li>
                <li>Ensure medication availability and price transparency</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <Award className="h-6 w-6 text-blue-600" />
                Why Choose Us
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Fast & Accurate</h3>
                  <p className="text-sm">
                    Get instant results from our AI-powered search engine
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Wide Network</h3>
                  <p className="text-sm">
                    Access to pharmacies across multiple locations
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Real-time Updates</h3>
                  <p className="text-sm">
                    Live inventory updates from partner pharmacies
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">User-Friendly</h3>
                  <p className="text-sm">
                    Simple, intuitive interface for all users
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                <Users className="h-6 w-6 text-blue-600" />
                Who We Serve
              </h2>
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold">Patients</h3>
                  <p className="text-sm">
                    Find medications quickly, compare prices, and locate nearby pharmacies
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold">Pharmacies</h3>
                  <p className="text-sm">
                    Manage inventory, reach more customers, and streamline operations
                  </p>
                </div>
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
