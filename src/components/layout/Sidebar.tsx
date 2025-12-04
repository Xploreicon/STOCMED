'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home,
  MessageSquare,
  History,
  Settings,
  LayoutDashboard,
  Package,
  ShoppingCart,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  userType: 'patient' | 'pharmacy';
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  disabled?: boolean;
  badge?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  userType,
  isCollapsed = false,
  onToggleCollapse,
  className,
}) => {
  const pathname = usePathname();

  const patientNavItems: NavItem[] = [
    {
      label: 'Home',
      icon: <Home className="h-5 w-5" />,
      href: '/dashboard',
    },
    {
      label: 'Chat Search',
      icon: <MessageSquare className="h-5 w-5" />,
      href: '/chat-search',
    },
    {
      label: 'Search History',
      icon: <History className="h-5 w-5" />,
      href: '/search-history',
    },
    {
      label: 'Profile Settings',
      icon: <Settings className="h-5 w-5" />,
      href: '/settings',
    },
  ];

  const pharmacyNavItems: NavItem[] = [
    {
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-5 w-5" />,
      href: '/pharmacy/dashboard',
    },
    {
      label: 'Inventory Management',
      icon: <Package className="h-5 w-5" />,
      href: '/pharmacy/inventory',
    },
    {
      label: 'Orders',
      icon: <ShoppingCart className="h-5 w-5" />,
      href: '/pharmacy/orders',
      disabled: true,
      badge: 'Coming Soon',
    },
    {
      label: 'Analytics',
      icon: <BarChart3 className="h-5 w-5" />,
      href: '/pharmacy/analytics',
      disabled: true,
      badge: 'Coming Soon',
    },
    {
      label: 'Settings',
      icon: <Settings className="h-5 w-5" />,
      href: '/pharmacy/settings',
    },
  ];

  const navItems = userType === 'patient' ? patientNavItems : pharmacyNavItems;

  return (
    <aside
      className={cn(
        'bg-white border-r border-gray-200 transition-all duration-300 flex flex-col',
        isCollapsed ? 'w-16' : 'w-64',
        className
      )}
    >
      {/* Navigation Items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.disabled ? '#' : item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-600'
                  : item.disabled
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
                isCollapsed && 'justify-center'
              )}
              onClick={(e) => item.disabled && e.preventDefault()}
            >
              <span className={cn('flex-shrink-0', isActive && 'text-blue-600')}>
                {item.icon}
              </span>
              {!isCollapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Toggle Button */}
      <div className="p-2 border-t border-gray-200">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          )}
        </button>
      </div>
    </aside>
  );
};
