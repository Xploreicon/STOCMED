import React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FileText, ShieldAlert, Settings, ClipboardList, Database, LogOut } from 'lucide-react';

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

  // Get admin / pharmacist authorization status
  const { data: userData, error } = await (supabase.from('users') as any)
    .select('is_admin, is_licensed_pharmacist')
    .eq('user_id', user.id)
    .single();

  if (error || (!userData?.is_admin && !userData?.is_licensed_pharmacist)) {
    redirect('/dashboard'); // Go back to patient dashboard if not authorized
  }

  const navItems = [
    { href: '/admin', label: 'Intakes', icon: ClipboardList },
    { href: '/admin/rx-queue', label: 'Rx queue', icon: FileText },
    { href: '/admin/audit', label: 'Audit', icon: Database },
    ...(userData.is_admin ? [{ href: '/admin/config', label: 'Config', icon: ShieldAlert }] : []),
  ];

  return (
    <div className="flex min-h-screen bg-surface text-ink">
      {/* Sidebar Navigation */}
      <aside className="hidden w-64 bg-ink text-surface lg:flex flex-col justify-between p-5 border-r border-ink">
        <div>
          <div className="flex items-center space-x-2.5 mb-8 px-2">
            <Settings className="w-6 h-6 text-blue-500" />
            <span className="font-bold text-lg tracking-tight font-display">
              StocMed Admin
            </span>
          </div>

          <nav className="space-y-1">
            <Link
              href="/admin"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-ink hover:text-white transition-colors"
            >
              <ClipboardList className="w-4 h-4 text-ink-light" />
              <span>Symptom Intakes</span>
            </Link>

            <Link
              href="/admin/rx-queue"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-ink hover:text-white transition-colors"
            >
              <FileText className="w-4 h-4 text-ink-light" />
              <span>Rx Verification</span>
            </Link>

            <Link
              href="/admin/audit"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-ink hover:text-white transition-colors"
            >
              <Database className="w-4 h-4 text-ink-light" />
              <span>Triage Logs</span>
            </Link>

            {userData.is_admin && (
              <Link
                href="/admin/config"
                className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-ink hover:text-white transition-colors"
              >
                <ShieldAlert className="w-4 h-4 text-ink-light" />
                <span>Safety Config</span>
              </Link>
            )}
          </nav>
        </div>

        <div className="border-t border-ink pt-4">
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-xs font-bold text-ink-light truncate max-w-[130px]">
                {user.email}
              </div>
              <div className="text-[10px] text-blue-400 uppercase tracking-wide font-semibold mt-0.5">
                {userData.is_admin ? 'Admin' : 'Pharmacist'}
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

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 flex flex-col min-h-screen">
        <header className="min-h-16 bg-white border-b border-border flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold bg-surface text-ink-muted px-2 py-0.5 rounded-full">
              Live Connection
            </span>
          </div>
          <nav className="flex min-w-0 flex-1 justify-end gap-1 overflow-x-auto lg:hidden">
            {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex shrink-0 items-center gap-1.5 rounded-button px-2 py-2 text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink"><Icon className="h-4 w-4" />{label}</Link>)}
          </nav>
        </header>

        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
