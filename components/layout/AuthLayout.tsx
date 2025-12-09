'use client';

import React from 'react';
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex flex-col items-center justify-center p-4">
      {/* Logo at top */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-blue-600 mb-2">StocMed</h1>
        <p className="text-gray-600">Healthcare Inventory Management</p>
      </div>

      {/* Auth Card */}
      <Card className={cn('w-full max-w-md shadow-lg', className)}>
        <CardContent className="pt-6">
          {(title || subtitle) && (
            <div className="mb-6 text-center">
              {title && (
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-sm text-gray-600">{subtitle}</p>
              )}
            </div>
          )}
          {children}
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-gray-600">
        <p>&copy; {new Date().getFullYear()} StocMed. All rights reserved.</p>
      </div>
    </div>
  );
};
