import { MainLayout } from '@/components/layout/MainLayout';

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout role="patient">{children}</MainLayout>;
}
