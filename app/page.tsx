import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

export default async function Landing() {
  // Check if user is logged in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Redirect based on user role
    const role = user.user_metadata?.role;
    if (role === 'pharmacy') {
      redirect('/pharmacy/dashboard');
    } else {
      redirect('/dashboard');
    }
  }

  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(startOfDay.getDate() + 1);

  const [
    { count: searchesToday = 0 } = {},
    { count: pharmaciesOnline = 0 } = {},
    { count: medicationsAvailable = 0 } = {},
  ] = await Promise.all([
    supabase
      .from('searches')
      .select('id', { count: 'exact', head: true })
      .gte('timestamp', startOfDay.toISOString())
      .lt('timestamp', endOfDay.toISOString()),
    supabase
      .from('pharmacies')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('drugs')
      .select('id', { count: 'exact', head: true })
      .gt('quantity_in_stock', 0),
  ]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: 'StocMed',
    description:
      "Nigeria's first AI-powered medication search platform helping patients discover pharmacies with their medications in stock.",
    url: 'https://askstocmed.com',
    logo: 'https://askstocmed.com/logo.png',
    areaServed: [
      { '@type': 'AdministrativeArea', name: 'Lagos' },
      { '@type': 'AdministrativeArea', name: 'Abuja' },
      { '@type': 'AdministrativeArea', name: 'Nigeria' },
    ],
    serviceType: ['Medication search', 'Pharmacy discovery', 'Drug price comparison'],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@askstocmed.com',
      availableLanguage: ['English'],
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-light-blue-bg to-white py-16 md:py-24 px-4">
        <div className="container mx-auto max-w-6xl text-center">
          <div className="flex justify-center mb-6">
            <Image
              src="/logo.png"
              alt="StocMed"
              width={240}
              height={80}
              className="h-20 w-auto"
              priority
            />
          </div>
          <h1 className="text-[32px] md:text-5xl lg:text-6xl font-bold text-dark-gray mb-4 md:mb-6">
            Find Your Medications in Minutes, Not Hours
          </h1>
          <p className="text-lg md:text-xl text-medium-gray mb-8 md:mb-10">
            Nigeria&apos;s First AI-Powered Medication Search Platform
          </p>

          {/* CTAs */}
          <div className="flex flex-col md:flex-row gap-4 justify-center items-center max-w-lg mx-auto">
            <Link href="/signup?role=patient" className="w-full md:w-auto">
              <Button className="w-full md:w-auto bg-primary-blue hover:bg-blue-700 text-white px-8 py-6 text-lg font-semibold rounded-lg">
                Find Medication
              </Button>
            </Link>
            <Link href="/signup?role=pharmacy" className="w-full md:w-auto">
              <Button
                variant="outline"
                className="w-full md:w-auto border-2 border-primary-blue text-primary-blue hover:bg-blue-50 px-8 py-6 text-lg font-semibold rounded-lg"
              >
                I&apos;m a Pharmacy
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Live Activity */}
      <section className="py-12 px-4 bg-white">
        <div className="container mx-auto max-w-6xl">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-dark-gray flex items-center gap-2">
              <span role="img" aria-label="fire">
                🔥
              </span>
              Live Activity
            </h2>
            <p className="text-sm text-medium-gray">
              Capturing demand signals from patients in real-time.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                label: 'Searches Today',
                value: searchesToday,
                subtext: 'Fresh intents from patients across Nigeria',
              },
              {
                label: 'Pharmacies Online',
                value: pharmaciesOnline,
                subtext: 'Active partners sharing inventory data',
              },
              {
                label: 'Medications Available',
                value: medicationsAvailable,
                subtext: 'Skus currently in stock on the network',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-white to-blue-50/70 shadow-sm transition hover:shadow-md"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary-blue/5 to-transparent animate-pulse [animation-duration:6s]" />
                <div className="relative px-6 py-6 sm:px-8 sm:py-8">
                  <p className="text-sm font-medium uppercase tracking-wide text-primary-blue">
                    {card.label}
                  </p>
                  <p className="mt-3 text-3xl sm:text-4xl font-bold text-dark-gray">
                    {(card.value ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-3 text-sm text-medium-gray leading-relaxed">{card.subtext}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value Props Section */}
      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Prop 1 */}
            <div className="text-center p-6">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-dark-gray mb-2">
                Search 100+ Medications
              </h3>
              <p className="text-medium-gray">
                Find any medication quickly with our comprehensive database
              </p>
            </div>

            {/* Prop 2 */}
            <div className="text-center p-6">
              <div className="text-5xl mb-4">📍</div>
              <h3 className="text-xl font-semibold text-dark-gray mb-2">
                Find Nearest Pharmacy
              </h3>
              <p className="text-medium-gray">
                Locate pharmacies near you with real-time availability
              </p>
            </div>

            {/* Prop 3 */}
            <div className="text-center p-6">
              <div className="text-5xl mb-4">💬</div>
              <h3 className="text-xl font-semibold text-dark-gray mb-2">
                AI-Powered Assistance
              </h3>
              <p className="text-medium-gray">
                Get instant help from our intelligent medication assistant
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-16 px-4 bg-light-blue-bg">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl md:text-4xl font-bold text-dark-gray text-center mb-12">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="bg-white rounded-lg p-8 shadow-sm">
              <div className="w-12 h-12 bg-primary-blue text-white rounded-full flex items-center justify-center text-xl font-bold mb-4">
                1
              </div>
              <h3 className="text-xl font-semibold text-dark-gray mb-3">
                Tell our AI what you need
              </h3>
              <p className="text-medium-gray">
                Simply describe your medication or health concern to our intelligent assistant
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-white rounded-lg p-8 shadow-sm">
              <div className="w-12 h-12 bg-primary-blue text-white rounded-full flex items-center justify-center text-xl font-bold mb-4">
                2
              </div>
              <h3 className="text-xl font-semibold text-dark-gray mb-3">
                See which pharmacies have it
              </h3>
              <p className="text-medium-gray">
                Get instant results showing nearby pharmacies with your medication in stock
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-white rounded-lg p-8 shadow-sm">
              <div className="w-12 h-12 bg-primary-blue text-white rounded-full flex items-center justify-center text-xl font-bold mb-4">
                3
              </div>
              <h3 className="text-xl font-semibold text-dark-gray mb-3">
                Visit or call to purchase
              </h3>
              <p className="text-medium-gray">
                Contact the pharmacy directly or visit to get your medication quickly
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-8 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-wrap justify-center items-center gap-6 text-medium-gray">
            <Link href="/about" className="hover:text-primary-blue transition-colors">
              About
            </Link>
            <span className="text-gray-300">|</span>
            <Link href="/contact" className="hover:text-primary-blue transition-colors">
              Contact
            </Link>
            <span className="text-gray-300">|</span>
            <Link href="/privacy" className="hover:text-primary-blue transition-colors">
              Privacy
            </Link>
            <span className="text-gray-300">|</span>
            <Link href="/terms" className="hover:text-primary-blue transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
