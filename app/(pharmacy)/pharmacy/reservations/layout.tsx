import { FeatureRouteGate } from '@/components/pharmacy/FeatureRouteGate'

export default function ReservationsLayout({ children }: { children: React.ReactNode }) {
  return <FeatureRouteGate feature="reservations">{children}</FeatureRouteGate>
}
