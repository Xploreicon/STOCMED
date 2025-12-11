'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Search,
  History,
  LayoutDashboard,
  Package,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  userType: 'patient' | 'pharmacy';
  className?: string;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
}

export const MobileNav: React.FC<MobileNavProps> = ({ userType, className }) => {
  const pathname = usePathname();

  const patientNavItems: NavItem[] = [
    {
      label: 'Home',
      icon: <Home className="h-6 w-6" />,
      href: '/dashboard',
    },
    {
      label: 'Search',
      icon: <Search className="h-6 w-6" />,
      href: '/chat',
    },
    {
      label: 'History',
      icon: <History className="h-6 w-6" />,
      href: '/history',
    },
  ];

  const pharmacyNavItems: NavItem[] = [
    {
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-6 w-6" />,
      href: '/pharmacy/dashboard',
    },
    {
      label: 'Inventory',
      icon: <Package className="h-6 w-6" />,
      href: '/pharmacy/inventory',
    },
    {
      label: 'Settings',
      icon: <Settings className="h-6 w-6" />,
      href: '/pharmacy/settings',
    },
  ];

  const navItems = userType === 'patient' ? patientNavItems : pharmacyNavItems;

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 lg:hidden z-40',
        className
      )}
    >
      <div className={cn('grid h-16', userType === 'patient' ? 'grid-cols-3' : 'grid-cols-3')}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 transition-colors',
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <span className={cn(isActive && 'text-blue-600')}>
                {item.icon}
              </span>
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
