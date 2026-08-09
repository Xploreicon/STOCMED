'use client'

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PharmacyFeatureKey } from '@/lib/pharmacy-features'

type FeatureRecord = {
  feature_key: PharmacyFeatureKey
  is_enabled: boolean
  enabled_at: string | null
  settings: Record<string, unknown>
}

type PharmacyFeaturesContextValue = {
  features: Partial<Record<PharmacyFeatureKey, FeatureRecord>>
  isEnabled: (key: PharmacyFeatureKey) => boolean
  isLoading: boolean
}

const PharmacyFeaturesContext = createContext<PharmacyFeaturesContextValue>({
  features: {},
  isEnabled: () => false,
  isLoading: true,
})

export function PharmacyFeaturesProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<{ features: FeatureRecord[] }>({
    queryKey: ['pharmacy-features'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/features')
      if (!response.ok) throw new Error('Could not load pharmacy features')
      return response.json()
    },
    staleTime: 30_000,
  })

  const features = useMemo(
    () => Object.fromEntries((data?.features ?? []).map(feature => [feature.feature_key, feature])),
    [data],
  ) as Partial<Record<PharmacyFeatureKey, FeatureRecord>>

  const value = useMemo<PharmacyFeaturesContextValue>(() => ({
    features,
    isEnabled: key => features[key]?.is_enabled === true,
    isLoading,
  }), [features, isLoading])

  return <PharmacyFeaturesContext.Provider value={value}>{children}</PharmacyFeaturesContext.Provider>
}

export function usePharmacyFeatures() {
  return useContext(PharmacyFeaturesContext)
}
