import type { ReactNode } from 'react';
import { PatientGuard } from '@/components/auth/PatientGuard';
import { PatientShell } from '@/components/layout/PatientShell';

export default function PatientLayout({ children }: { children: ReactNode }) {
  return <PatientGuard><PatientShell>{children}</PatientShell></PatientGuard>;
}
