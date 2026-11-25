'use client';

// Clinical intake is deliberately unavailable in this package.
export function useFeatureFlags() {
  return { staffedSafetyFlowsEnabled: false as const };
}
