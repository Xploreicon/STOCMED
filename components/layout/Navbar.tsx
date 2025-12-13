'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, X, Search, Bell, ChevronDown, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';

interface NavbarProps {
  patientPoints?: number;
  pharmacyName?: string;
  onMenuClick?: () => void;
  userRole?: 'patient' | 'pharmacy';
}

export const Navbar: React.FC<NavbarProps> = ({
  patientPoints = 0,
  pharmacyName = 'Pharmacy Name',
  onMenuClick,
  userRole,
}) => {
  const router = useRouter();
  const { user, isPatient, isPharmacy, isLoading } = useUser();
  const resolvedRole = userRole ?? (isPatient ? 'patient' : isPharmacy ? 'pharmacy' : undefined);
  const shouldShowPatientUI = resolvedRole === 'patient' || (!!user && !resolvedRole);
  const shouldShowPharmacyUI = resolvedRole === 'pharmacy';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
    onMenuClick?.();
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo and Mobile Menu */}
          <div className="flex items-center gap-4">
            {user && (
              <button
                onClick={toggleMobileMenu}
                className="lg:hidden p-2 rounded-md hover:bg-gray-100 transition-colors"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? (
                  <X className="h-6 w-6 text-gray-600" />
                ) : (
                  <Menu className="h-6 w-6 text-gray-600" />
                )}
              </button>
            )}
            <Link href="/" className="flex items-center">
              <Image
                src="/logo.png"
                alt="StocMed"
                width={120}
                height={40}
                className="h-10 w-auto"
                priority
              />
            </Link>
          </div>

          {/* Right side - Conditional rendering based on auth state */}
          <div className="flex items-center gap-4">
            {!user && !isLoading && (
              <>
                <Link href="/login">
                  <Button
                    variant="ghost"
                    className="hidden sm:inline-flex"
                  >
                    Login
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Sign Up
                  </Button>
                </Link>
              </>
            )}

            {user && shouldShowPatientUI && (
              <>
                <button
                  className="p-2 rounded-md hover:bg-gray-100 transition-colors"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5 text-gray-600" />
                </button>
                <div className="hidden sm:flex items-center px-3 py-1 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium text-blue-600">
                    Points: {patientPoints}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="hidden sm:inline-flex"
                >
                  Logout
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  className="sm:hidden"
                  aria-label="Logout"
                >
                  <LogOut className="h-5 w-5 text-gray-600" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-100 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                        <span className="text-white text-sm font-medium">P</span>
                      </div>
                      <ChevronDown className="h-4 w-4 text-gray-600 hidden sm:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => {
                        router.push('/profile');
                      }}
                    >
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        router.push('/settings');
                      }}
                    >
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="text-red-600"
                    >
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {user && shouldShowPharmacyUI && (
              <>
                <div className="hidden sm:flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    {pharmacyName}
                  </span>
                </div>
                <button
                  className="relative p-2 rounded-md hover:bg-gray-100 transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5 text-gray-600" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-100 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                        <span className="text-white text-sm font-medium">Rx</span>
                      </div>
                      <ChevronDown className="h-4 w-4 text-gray-600 hidden sm:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem>
                      Pharmacy Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="text-red-600"
                    >
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
