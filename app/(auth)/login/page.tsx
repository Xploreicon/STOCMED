'use client';

import { Button } from '@/components/ui/button'

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/brand/Logo';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';

export const dynamic = 'force-dynamic'

export default function Login() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || null;
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    general?: string;
  }>({});

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
        const role = data.user.user_metadata?.role || 'patient';
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.push(role === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard');
        }
        router.refresh();
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
    <div className="w-full min-h-screen flex flex-col text-ink bg-page-wash">
      <div className="p-6">
        <Logo size={32} wordSize={18} href="/" />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-[72px]">
        <div className="w-full max-w-[420px] bg-white border border-border rounded-card-lg shadow-lg p-8 sm:p-10">
          <h1 className="font-display font-medium text-[28px] text-ink text-center">Welcome back</h1>
          <p className="text-[15px] text-ink-muted text-center mt-2 mb-8">Log in to continue to StocMed</p>

          <GoogleOAuthButton
            next={redirectTo}
            onError={(message) => setErrors(message ? { general: message } : {})}
          />
          <div className="flex items-center gap-3 my-6" aria-hidden="true">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[13px] text-ink-light">or use email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {errors.general && (
              <div className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger font-medium">
                {errors.general}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-[14px] font-medium text-ink mb-2">Email address</label>
              <input
                id="email"
                type="email"
                placeholder="you@email.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading}
                className={`${inputCls} ${errors.email ? 'border-danger focus:border-danger focus:ring-danger/15' : ''}`}
              />
              {errors.email && <p className="text-xs text-danger font-medium mt-1.5">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-[14px] font-medium text-ink mb-2">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={isLoading}
                className={`${inputCls} ${errors.password ? 'border-danger focus:border-danger focus:ring-danger/15' : ''}`}
              />
              {errors.password && <p className="text-xs text-danger font-medium mt-1.5">{errors.password}</p>}
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
        </div>
      </div>
    </div>
  );
}
