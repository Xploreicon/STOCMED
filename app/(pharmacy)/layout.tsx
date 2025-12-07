import { MainLayout } from '@/components/layout/MainLayout';

export default function PharmacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout role="pharmacy">{children}</MainLayout>;
}
