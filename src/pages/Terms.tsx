import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function Terms() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">Terms and Conditions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-gray-700">
            <section>
              <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing and using StocMed, you agree to be bound by these Terms and Conditions.
                If you do not agree with any part of these terms, you may not use our service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">2. Use of Service</h2>
              <p>
                StocMed provides a platform for searching and locating medications at pharmacies.
                The information provided is for informational purposes only and should not replace
                professional medical advice.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">3. User Responsibilities</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide accurate information when creating an account</li>
                <li>Keep your account credentials secure</li>
                <li>Use the service in compliance with applicable laws</li>
                <li>Not misuse or attempt to harm the platform</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">4. Intellectual Property</h2>
              <p>
                All content, features, and functionality of StocMed are owned by us and are
                protected by international copyright, trademark, and other intellectual property laws.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">5. Limitation of Liability</h2>
              <p>
                StocMed is provided "as is" without warranties of any kind. We are not liable
                for any damages arising from the use or inability to use our service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">6. Changes to Terms</h2>
              <p>
                We reserve the right to modify these terms at any time. Continued use of the
                service after changes constitutes acceptance of the modified terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">7. Contact</h2>
              <p>
                If you have any questions about these Terms and Conditions, please contact us
                through our contact page.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
