import { FeatureRouteGate } from '@/components/pharmacy/FeatureRouteGate'

export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  return <FeatureRouteGate feature="purchase_orders_and_receiving">{children}</FeatureRouteGate>
}
