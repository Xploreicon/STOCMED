'use client';

import { useState } from 'react';
import Link from 'next/link';
import { updateRecoveryPassword } from '@/lib/auth/recovery';
import { useAuth } from '@/hooks/useAuth';
import { PasswordField } from '@/components/auth/PasswordField';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';


export default function UpdatePassword() {
  const { loading, recovery, signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !recovery) return;

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

      const { error: updateError } = await updateRecoveryPassword(password);

      if (updateError) {
        setError('We could not update your password. Try again or request a new reset code.');
        return;
      }

      setMessage('Your password has been updated. You can now sign in with your new password.');
      try { await signOut(); } catch { setMessage('Your password has been updated. Return to sign in to continue.'); }
    } catch (unknownError) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <AuthShell title="Checking your recovery session" description="Please wait while we verify your password recovery session."><p role="status" className="text-sm text-ink-muted">Loading your account…</p></AuthShell>;
  if (!message && !recovery) return <AuthShell title="Request a new reset code" description="Verify the reset code from your email before choosing a new password."><p role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">A password recovery session is required.</p><Link href="/forgot-password" className="mt-6 flex h-12 items-center justify-center rounded-button bg-primary text-white">Request a reset code</Link></AuthShell>;

  return (
    <AuthShell title={message ? 'Password updated' : 'Choose a new password'} description={message ? 'Your account is ready for your next sign-in.' : 'Use at least 8 characters for your new password.'}>
      {message ? (
        <div className="space-y-6">
          <p role="status" className="rounded-button border border-success/20 bg-success/5 px-4 py-4 text-sm leading-6 text-success">{message}</p>
          <Link href="/login" className="flex h-12 w-full items-center justify-center rounded-button bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-ink">New password</label>
            <PasswordField id="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} disabled={submitting} aria-describedby={error ? 'new-password-error' : undefined} aria-invalid={Boolean(error)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-ink">Confirm password</label>
            <PasswordField id="confirmPassword" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" autoComplete="new-password" required minLength={8} disabled={submitting} aria-describedby={error ? 'new-password-error' : undefined} aria-invalid={Boolean(error)} />
          </div>
          {error && <div id="new-password-error" role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm leading-6 text-danger">{error}</div>}
          <Button type="submit" className="h-12 w-full" disabled={submitting}>{submitting ? 'Updating password…' : 'Update password'}</Button>
          <p className="text-center text-sm text-ink-muted"><Link href="/forgot-password" className="font-medium text-primary hover:underline">Request a new reset code</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
