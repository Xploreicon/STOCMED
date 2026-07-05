'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Lock } from 'lucide-react';

export default function UpdatePassword() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (!password || password.length < 8) {
      setError('Password should be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        console.error('Password update error:', updateError);
        setError('We could not update your password. Please retry the reset link.');
        return;
      }

      setMessage('Password updated successfully. Redirecting you to sign in…');
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (unknownError) {
      console.error('Unexpected update error:', unknownError);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left side - Brand Panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-brand-panel p-12 text-primary-foreground lg:flex relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />

        <div className="relative">
          <Image
            src="/logo.png"
            alt="StocMed"
            width={160}
            height={53}
            className="h-10 w-auto brightness-0 invert"
            priority
          />
        </div>

        <div className="relative max-w-md space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
            <Lock className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight">
            Set your new password.
          </h1>
          <p className="text-sm opacity-80 leading-relaxed">
            Choose a strong password with at least 8 characters. Your session will be secured with the new credentials immediately.
          </p>
          <div className="flex items-center gap-2 text-sm opacity-70">
            <ShieldCheck className="h-4 w-4" />
            End-to-end encrypted
          </div>
        </div>

        <div className="relative text-sm opacity-60">
          © {new Date().getFullYear()} StocMed. All rights reserved.
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex w-full flex-col lg:w-1/2">
        {/* Mobile brand strip */}
        <div className="lg:hidden bg-brand-panel px-4 py-4 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="StocMed"
            width={120}
            height={40}
            className="h-7 w-auto brightness-0 invert"
            priority
          />
          <span className="text-xs text-white/70 border-l border-white/20 pl-3">Secure Password Reset</span>
        </div>

        <div className="flex flex-1 items-center justify-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">Choose a new password</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter and confirm your new password to complete the reset.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-ink">
                  New password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  disabled={submitting}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-ink">
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  disabled={submitting}
                  className="h-11"
                />
              </div>

              {message && (
                <div className="rounded-md border border-success/20 bg-success/5 px-4 py-3 text-sm text-success shadow-sm">
                  {message}
                </div>
              )}

              {error && (
                <div className="rounded-md border border-danger bg-danger/5 px-4 py-3 text-sm text-danger shadow-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={submitting}
              >
                {submitting ? 'Updating password…' : 'Update password'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
