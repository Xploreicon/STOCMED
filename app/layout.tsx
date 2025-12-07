import type { Metadata } from 'next'
import './globals.css'
import ReactQueryProvider from '@/components/providers/ReactQueryProvider'

export const metadata: Metadata = {
  title: 'StocMed - Find Your Medications in Minutes',
  description: "Nigeria's First AI-Powered Medication Search Platform",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  )
}
