'use client';

import React from 'react';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  title,
  subtitle,
  className,
}) => {
  return (
    <div className="min-h-screen bg-brand-gradient flex flex-col items-center justify-center p-4">
      {/* Logo at top */}
      <div className="mb-8 text-center">
        <Image
          src="/logo.png"
          alt="StocMed"
          width={180}
          height={60}
          className="h-12 w-auto mx-auto"
          priority
        />
        <p className="text-ink-muted mt-2">Healthcare Inventory Management</p>
      </div>

      {/* Auth Card */}
      <Card className={cn('w-full max-w-md shadow-lg border-border', className)}>
        <CardContent className="pt-6">
          {(title || subtitle) && (
            <div className="mb-6 text-center">
              {title && (
                <h2 className="text-2xl font-display font-bold text-ink mb-2">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-sm text-ink-muted">{subtitle}</p>
              )}
            </div>
          )}
          {children}
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-ink-muted">
        <p>&copy; {new Date().getFullYear()} StocMed. All rights reserved.</p>
      </div>
    </div>
  );
};
