import type { Metadata } from 'next'
import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
