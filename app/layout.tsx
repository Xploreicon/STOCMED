import type { Metadata } from 'next'
import { Inter, Source_Serif_4 } from 'next/font/google'
import './globals.css'
import ReactQueryProvider from '@/components/providers/ReactQueryProvider'
import { Toaster } from 'sonner'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'StocMed - Find Medications in Nigeria | AI-Powered Pharmacy Search',
  description:
    "Nigeria's first AI-powered medication search platform. Find available drugs at pharmacies near you in Lagos, Abuja, and across Nigeria. Check prices, stock availability, and get directions.",
  metadataBase: new URL('https://askstocmed.com'),
  keywords: [
    'pharmacy Nigeria',
    'find medication Lagos',
    'drug availability',
    'pharmacy near me',
    'medicine search Nigeria',
    'StocMed',
    'medication finder',
  ],
  openGraph: {
    title: 'StocMed - Find Your Medications in Minutes',
    description: 'AI-powered pharmacy search platform for Nigeria',
    url: 'https://askstocmed.com',
    siteName: 'StocMed',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
    locale: 'en_NG',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StocMed - Find Medications in Nigeria',
    description: 'AI-powered pharmacy search',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: 'https://askstocmed.com',
  },
  icons: {
    icon: '/favicon.png',
  },
  manifest: '/manifest.json',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body className="font-body antialiased">
        <ReactQueryProvider>
          {children}
          <Toaster position="top-right" richColors />
        </ReactQueryProvider>
      </body>
    </html>
  )
}
