import React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Building2, FileText, ShieldAlert, Settings, ClipboardList, Database, LogOut, ShieldCheck, PackageSearch } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/admin');
  }

  // The oversight landing page is available to administrators and
  // provenance-verified licensed pharmacists. Individual admin APIs retain
  // their narrower capability checks (admin-only configuration/verification,
  // and admin or StocMed-SP prescription oversight).
  const { data: userData, error } = await (supabase.from('users') as any)
    .select('is_admin, is_stocmed_sp, is_licensed_pharmacist')
    .eq('user_id', user.id)
    .single();

  const isStocmedSp = Boolean(
    userData?.is_stocmed_sp && userData?.is_licensed_pharmacist
  );
  const isLicensedPharmacist = Boolean(userData?.is_licensed_pharmacist);

  if (error || (!userData?.is_admin && !isLicensedPharmacist)) {
    redirect('/dashboard');
  }

  const navItems = [
    { href: '/admin', label: 'Symptom intakes', icon: ClipboardList },
    ...(userData.is_admin || isStocmedSp
      ? [{ href: '/admin/rx-queue', label: isStocmedSp ? 'Rx pre-review' : 'Rx oversight', icon: FileText }]
      : []),
    ...(userData.is_admin
      ? [
          { href: '/admin/audit', label: 'Triage logs', icon: Database },
          { href: '/admin/pharmacy-verifications', label: 'Pharmacy verification', icon: Building2 },
          { href: '/admin/catalogue-review', label: 'Catalogue review', icon: PackageSearch },
          { href: '/admin/config', label: 'Safety config', icon: ShieldAlert },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-screen bg-surface text-ink">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-ink bg-ink p-5 text-surface lg:flex">
        <div>
          <div className="mb-8 flex items-center gap-2.5 px-2">
            <ShieldCheck className="h-6 w-6 text-blue-400" />
            <div>
              <span className="block font-display text-lg font-bold tracking-tight">StocMed</span>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-ink-light">Oversight console</span>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-white/10 hover:text-white"
              >
                <Icon className="h-4 w-4 shrink-0 text-blue-300" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-t border-ink pt-4">
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-xs font-bold text-ink-light truncate max-w-[130px]">
                {user.email}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-400">
                {userData.is_admin ? 'StocMed admin' : isStocmedSp ? 'StocMed SP' : 'Licensed pharmacist'}
              </div>
            </div>
            <Link
              href="/dashboard"
              className="p-2 text-ink-light hover:text-white hover:bg-ink rounded-lg transition-colors"
              title="Return to patient dashboard"
            >
              <LogOut className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </aside>

      <main className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 shrink-0 text-primary lg:hidden" aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-ink">Oversight console</span>
                <span className="hidden rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted sm:inline-flex">
                  {isStocmedSp ? 'Clinical pre-review' : 'Read only'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-light lg:hidden">
                {userData.is_admin
                  ? 'StocMed admin'
                  : isStocmedSp
                    ? 'StocMed superintendent pharmacist'
                    : 'Licensed pharmacist'}
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-button border border-border px-3 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink lg:hidden"
              title="Leave oversight console"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden" aria-label="Oversight navigation">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex shrink-0 items-center gap-1.5 rounded-button px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
