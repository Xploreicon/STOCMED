'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider'
import type { PharmacyFeatureKey } from '@/lib/pharmacy-features'

export function FeatureRouteGate({
  feature,
  children,
}: {
  feature: PharmacyFeatureKey
  children: ReactNode
}) {
  const router = useRouter()
  const { isEnabled, isLoading } = usePharmacyFeatures()
  const enabled = isEnabled(feature)

  useEffect(() => {
    if (!isLoading && !enabled) router.replace('/pharmacy/settings/features')
  }, [enabled, feature, isLoading, router])

  if (isLoading || !enabled) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return children
}
