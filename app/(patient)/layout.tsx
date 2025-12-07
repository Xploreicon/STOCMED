import { MainLayout } from '@/components/layout/MainLayout';

export const dynamic = 'force-dynamic'

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout role="patient">{children}</MainLayout>;
}
