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
    .eq('id', user.id)
    .single();

  if (error || (!userData?.is_admin && !userData?.is_licensed_pharmacist)) {
    redirect('/dashboard'); // Go back to patient dashboard if not authorized
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col justify-between p-5 border-r border-slate-800">
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
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ClipboardList className="w-4 h-4 text-slate-400" />
              <span>Symptom Intakes</span>
            </Link>

            <Link
              href="/admin/rx-queue"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-800 hover:text-white transition-colors"
            >
              <FileText className="w-4 h-4 text-slate-400" />
              <span>Rx Verification</span>
            </Link>

            <Link
              href="/admin/audit"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-800 hover:text-white transition-colors"
            >
              <Database className="w-4 h-4 text-slate-400" />
              <span>Triage Logs</span>
            </Link>

            {userData.is_admin && (
              <Link
                href="/admin/config"
                className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-800 hover:text-white transition-colors"
              >
                <ShieldAlert className="w-4 h-4 text-slate-400" />
                <span>Safety Config</span>
              </Link>
            )}
          </nav>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-xs font-bold text-slate-400 truncate max-w-[130px]">
                {user.email}
              </div>
              <div className="text-[10px] text-blue-400 uppercase tracking-wide font-semibold mt-0.5">
                {userData.is_admin ? 'Admin' : 'Pharmacist'}
              </div>
            </div>
            <Link
              href="/dashboard"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Return to patient dashboard"
            >
              <LogOut className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-screen">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              Live Connection
            </span>
          </div>
        </header>

        <div className="flex-1 p-8 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
