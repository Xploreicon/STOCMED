import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import ReactQueryProvider from '@/components/providers/ReactQueryProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

const jakarta = localFont({
  src: [
    { path: '../public/fonts/PlusJakartaSans-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../public/fonts/PlusJakartaSans-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../public/fonts/PlusJakartaSans-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../public/fonts/PlusJakartaSans-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-jakarta', display: 'swap',
});

export const metadata: Metadata = {
  title: 'StocMed',
  description: 'Find medicines, compare availability, and manage pharmacy pickup holds.',
  icons: { icon: '/favicon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#2A4EB6', interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={jakarta.variable}>
    <body className="font-body antialiased">
      <ReactQueryProvider>
        <AuthProvider>
          {children}
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </ReactQueryProvider>
    </body>
  </html>;
}
