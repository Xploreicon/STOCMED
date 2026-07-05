'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ShieldCheck, KeyRound } from 'lucide-react';

export default function ForgotPassword() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter the email address linked to your account.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${window.location.origin}/auth-callback`,
        }
      );

      if (resetError) {
        console.error('Password reset error:', resetError);
        setError(
          'We could not start the reset right now. Please double-check the email or try again later.'
        );
        return;
      }

      setMessage(
        'If that email is registered, a reset link is on its way. Check your inbox and follow the instructions.'
      );
    } catch (unknownError) {
      console.error('Unexpected reset error:', unknownError);
      setError('Something went wrong. Please try again in a moment.');
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
            <KeyRound className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight">
            Secure account recovery.
          </h1>
          <p className="text-sm opacity-80 leading-relaxed">
            We&apos;ll send a secure, time-limited link to your registered email address. Your account data remains protected throughout the process.
          </p>
          <div className="flex items-center gap-2 text-sm opacity-70">
            <ShieldCheck className="h-4 w-4" />
            NDPR-compliant data handling
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
          <span className="text-xs text-white/70 border-l border-white/20 pl-3">Secure Account Recovery</span>
        </div>

        <div className="flex flex-1 items-center justify-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">Reset password</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter the email address linked to your account and we&apos;ll send you a secure link to set a new password.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-ink">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
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
                {submitting ? 'Sending reset link…' : 'Send reset link'}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              Remembered your password?{' '}
              <Link
                href="/login"
                className="font-semibold text-primary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
