'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface FeatureFlags {
  staffedSafetyFlowsEnabled: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlags>({
  staffedSafetyFlowsEnabled: false,
});

export function FeatureFlagsProvider({
  children,
  staffedSafetyFlowsEnabled,
}: FeatureFlags & { children: ReactNode }) {
  return (
    <FeatureFlagsContext.Provider value={{ staffedSafetyFlowsEnabled }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
