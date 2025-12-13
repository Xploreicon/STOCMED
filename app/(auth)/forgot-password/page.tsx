'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-gray-900">Reset password</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter the email address linked to your account and we’ll send you a secure link to set a new password.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
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
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-11"
            disabled={submitting}
          >
            {submitting ? 'Sending reset link…' : 'Send reset link'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-600">
          Remembered your password?{' '}
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="font-medium text-primary-blue hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
