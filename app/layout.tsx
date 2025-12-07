import type { Metadata } from 'next'
import './globals.css'
import ReactQueryProvider from '@/components/providers/ReactQueryProvider'
import { Toaster } from 'sonner'

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
        <ReactQueryProvider>
          {children}
          <Toaster position="top-right" richColors />
        </ReactQueryProvider>
      </body>
    </html>
  )
}
