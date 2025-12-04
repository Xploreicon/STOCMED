'use client';

import React, { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: React.ReactNode;
  authState?: 'patient' | 'pharmacy';
  patientPoints?: number;
  pharmacyName?: string;
  onLogout?: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  authState = 'patient',
  patientPoints = 0,
  pharmacyName = 'Pharmacy Name',
  onLogout,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const toggleMobileSidebar = () => {
    setIsMobileSidebarOpen(!isMobileSidebarOpen);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <Navbar
        authState={authState}
        patientPoints={patientPoints}
        pharmacyName={pharmacyName}
        onMenuClick={toggleMobileSidebar}
        onLogout={onLogout}
      />

      <div className="flex h-[calc(100vh-4rem)]">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block">
          <Sidebar
            userType={authState}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={toggleSidebarCollapse}
            className="h-full"
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        {isMobileSidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={toggleMobileSidebar}
            />
            <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
              <Sidebar
                userType={authState}
                isCollapsed={false}
                onToggleCollapse={toggleMobileSidebar}
                className="h-full shadow-xl"
              />
            </div>
          </>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20 lg:pb-6">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav userType={authState} />
    </div>
  );
};
