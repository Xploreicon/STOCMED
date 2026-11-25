'use client';

import { Button } from '@/components/ui/button'

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordField } from '@/components/auth/PasswordField';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';
import { useAuth } from '@/hooks/useAuth';
import { safePatientDestination } from '@/lib/auth/native-oauth';


const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  native_oauth_start_failed: 'Google sign-in could not be started. Please try again.',
  native_oauth_callback_failed: 'Google sign-in did not complete. Please try again.',
  native_oauth_session_failed: 'Your secure session could not be restored in the app. Please try again.',
  native_oauth_session_missing: 'Your secure session could not be found in the app. Please try again.',
  native_oauth_role_check_failed: 'Your account role could not be verified. Please try again.',
  oauth_role_sync_failed: 'Your account role could not be verified. Please try again.',
  profile_lookup_failed: 'Your StocMed profile could not be verified. Please try again.',
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safePatientDestination(searchParams.get('redirectTo'));
  const isAuthCallback = searchParams.has('code') || searchParams.has('error') || searchParams.has('error_code');
  const { user, profile, loading, error: accountError, refreshProfile } = useAuth();
  useEffect(() => {
    if (!isAuthCallback && !loading && !accountError && user && profile?.role === 'patient') {
      router.replace(profile.location?.trim() ? redirectTo : '/profile?required=location');
    }
  }, [loading, user, profile, accountError, router, redirectTo, isAuthCallback]);
  const oauthError = searchParams.get('error');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    general?: string;
  }>(oauthError && OAUTH_ERROR_MESSAGES[oauthError]
    ? { general: OAUTH_ERROR_MESSAGES[oauthError] }
    : {});

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const validateForm = () => {
    const newErrors: typeof errors = {};

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        setErrors({ general: error.message });
        return;
      }

      if (data.user) {
        const { data: savedProfile, error: profileError } = await supabase.from('users')
          .select('role, location').eq('user_id', data.user.id).maybeSingle();
        if (profileError) {
          await supabase.auth.signOut();
          setErrors({ general: 'Your account role could not be verified. Please try again.' });
          return;
        }
        if (savedProfile?.role && savedProfile.role !== 'patient') {
          await supabase.auth.signOut();
          setErrors({ general: 'This app supports patient accounts. Sign in with a patient account.' });
          return;
        }
        await refreshProfile();
        router.replace(!savedProfile?.role ? '/complete-profile' : savedProfile.location?.trim() ? redirectTo : '/profile?required=location');
      }
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : 'Login failed. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls =
    'w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60';

  return (
    <AuthShell title="Welcome back" description="Sign in to continue to StocMed.">
          {searchParams.get('verifyEmail') === '1' && (
            <div role="status" className="mb-6 rounded-button border border-primary/20 bg-surface px-4 py-3 text-sm leading-6 text-ink">
              Check your email for the confirmation link, then return here to sign in.
            </div>
          )}

          <GoogleOAuthButton
            next={redirectTo}
            onError={(message) => setErrors(message ? { general: message } : {})}
          />
          <div className="flex items-center gap-3 my-6" aria-hidden="true">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[13px] text-ink-light">or use email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
            {errors.general && (
              <div role="alert" className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger font-medium">
                {errors.general}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-[14px] font-medium text-ink mb-2">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                placeholder="you@email.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading}
                className={`${inputCls} ${errors.email ? 'border-danger focus:border-danger focus:ring-danger/15' : ''}`}
              />
              {errors.email && <p id="login-email-error" className="text-xs text-danger font-medium mt-1.5">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-[14px] font-medium text-ink mb-2">Password</label>
              <PasswordField
                id="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                placeholder="Enter your password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={isLoading}
                className={`${inputCls} ${errors.password ? 'border-danger focus:border-danger focus:ring-danger/15' : ''}`}
              />
              {errors.password && <p id="login-password-error" className="text-xs text-danger font-medium mt-1.5">{errors.password}</p>}
            </div>

            <div className="flex items-center justify-end">
              <Link href="/forgot-password" className="text-[14px] font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="h-12 w-full bg-primary text-white text-[16px] font-medium rounded-button mt-2 hover:bg-[var(--primary-hover)] disabled:opacity-60"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[13px] text-ink-light">New to StocMed?</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Link
            href="/signup"
            className="h-12 w-full flex items-center justify-center bg-white text-primary border-[1.5px] border-primary text-[15px] font-medium rounded-button hover:bg-surface"
          >
            Create an account
          </Link>
    </AuthShell>
  );
}
