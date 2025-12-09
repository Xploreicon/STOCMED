import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'STOCMED - Healthcare Management Platform',
  description: 'AI-powered healthcare management platform for patients and pharmacies',
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
