import React, { useState } from 'react';
import { Menu, X, Search, Bell, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavbarProps {
  authState?: 'logged-out' | 'patient' | 'pharmacy';
  patientPoints?: number;
  pharmacyName?: string;
  onMenuClick?: () => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  authState = 'logged-out',
  patientPoints = 0,
  pharmacyName = 'Pharmacy Name',
  onMenuClick,
  onLogout,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
    onMenuClick?.();
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo and Mobile Menu */}
          <div className="flex items-center gap-4">
            {authState !== 'logged-out' && (
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
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-blue-600">StocMed</h1>
            </div>
          </div>

          {/* Right side - Conditional rendering based on auth state */}
          <div className="flex items-center gap-4">
            {authState === 'logged-out' && (
              <>
                <Button
                  variant="ghost"
                  className="hidden sm:inline-flex"
                  onClick={() => console.log('Login clicked')}
                >
                  Login
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => console.log('Sign Up clicked')}
                >
                  Sign Up
                </Button>
              </>
            )}

            {authState === 'patient' && (
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
                    <DropdownMenuItem onClick={() => console.log('Profile')}>
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => console.log('Settings')}>
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onLogout}
                      className="text-red-600"
                    >
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {authState === 'pharmacy' && (
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
                    <DropdownMenuItem onClick={() => console.log('Pharmacy Profile')}>
                      Pharmacy Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => console.log('Settings')}>
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onLogout}
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
