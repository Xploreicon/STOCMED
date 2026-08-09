'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Calculator,
  ClipboardCheck,
  CreditCard,
  HeartHandshake,
  Loader2,
  MessageCircle,
  PackageOpen,
  PackageSearch,
  ShoppingBag,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { SettingsTabStrip } from '@/components/pharmacy/SettingsTabStrip'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider'
import {
  type PharmacyFeatureKey,
  type PharmacyFeaturePreset,
} from '@/lib/pharmacy-features'

type Group = 'SELLING' | 'STOCK' | 'PEOPLE' | 'GROWTH'

type Definition = {
  key: PharmacyFeatureKey
  group: Group
  name: string
  benefit: string
  change: string
  icon: LucideIcon
  settingsHref?: string
}

const FEATURES: Definition[] = [
  { key: 'packs_and_units', group: 'SELLING', name: 'Sell in packs and cartons', benefit: 'Sell a single tablet, a card, a pack, or a full carton.', change: 'Adds one-tap pack choices at the till.', icon: PackageOpen, settingsHref: '/pharmacy/inventory' },
  { key: 'credit_sales', group: 'SELLING', name: 'Sell on credit', benefit: 'Keep a simple record of who owes you and part payments.', change: 'Adds Credit as a payment choice.', icon: CreditCard },
  { key: 'reservations', group: 'SELLING', name: 'Hold stock for patients', benefit: 'Let patients reserve eligible stock for pickup.', change: 'Adds your reservations queue.', icon: ClipboardCheck, settingsHref: '/pharmacy/reservations' },
  { key: 'whatsapp_receipts', group: 'SELLING', name: 'WhatsApp receipts', benefit: 'Send a receipt to the customer with one tap.', change: 'Adds WhatsApp to the receipt screen.', icon: MessageCircle },
  { key: 'purchase_orders_and_receiving', group: 'STOCK', name: 'Buying and receiving', benefit: 'Create purchase orders and receive batches into stock.', change: 'Adds Procurement to the menu.', icon: ShoppingBag, settingsHref: '/pharmacy/procurement' },
  { key: 'smart_reorder', group: 'STOCK', name: 'Smart reorder suggestions', benefit: 'See what may run out and draft an order in one tap.', change: 'Adds reorder suggestions to your dashboard.', icon: PackageSearch },
  { key: 'stock_exchange', group: 'STOCK', name: 'Near-expiry stock exchange', benefit: 'Offer eligible short-dated stock to verified pharmacies nearby.', change: 'Kept unavailable until legal clearance.', icon: Boxes },
  { key: 'quickbooks_export', group: 'STOCK', name: 'Accounting export', benefit: 'Download a spreadsheet ready for your accounting workflow.', change: 'Adds accounting export to Reports.', icon: Calculator, settingsHref: '/pharmacy/reports' },
  { key: 'staff_accounts', group: 'PEOPLE', name: 'Staff PINs', benefit: 'Let counter staff sell with a quick four-digit PIN.', change: 'Adds staff switching and staff sales totals.', icon: Users },
  { key: 'customers', group: 'PEOPLE', name: 'Customer records', benefit: 'Save a name and phone for receipts and refill reminders.', change: 'Adds an optional customer at the till.', icon: HeartHandshake },
  { key: 'multi_branch', group: 'PEOPLE', name: 'More than one branch', benefit: 'Keep stock, staff, and reporting separate by outlet.', change: 'Adds branch controls after the pilot.', icon: Building2 },
  { key: 'notifications', group: 'GROWTH', name: 'Owner updates', benefit: 'Receive one useful daily sales summary.', change: 'Adds notification choices.', icon: Bell },
  { key: 'price_benchmark', group: 'GROWTH', name: 'Local price comparison', benefit: 'Compare your price with an anonymous local average.', change: 'Adds price guidance where enough data exists.', icon: BarChart3 },
  { key: 'unmet_demand_widget', group: 'GROWTH', name: 'What customers cannot find', benefit: 'See medicines people nearby searched for but could not find.', change: 'Adds a demand card to your dashboard.', icon: Sparkles },
  { key: 'loyalty', group: 'GROWTH', name: 'Customer loyalty', benefit: 'Reward repeat customers with a simple points balance.', change: 'Adds loyalty at checkout.', icon: HeartHandshake },
]

const PRESETS: Array<{ key: PharmacyFeaturePreset; name: string; detail: string }> = [
  { key: 'full_retail_shop', name: 'Full retail shop', detail: 'Staff, customers, credit sales, and owner updates.' },
  { key: 'multi_branch_owner', name: 'Multi-branch owner', detail: 'Branches, staff, and owner updates.' },
  { key: 'buying_and_stock', name: 'Buying & stock', detail: 'Procurement, smart reorder, and accounting export.' },
  { key: 'just_the_basics', name: 'Just the basics', detail: 'Turn off every optional feature. Your data stays safe.' },
]

type PendingChange = {
  body:
    | { feature_key: PharmacyFeatureKey; is_enabled: boolean }
    | { preset: PharmacyFeaturePreset }
  description: string
}

type FeaturesResponse = {
  features: Array<{
    feature_key: PharmacyFeatureKey
    is_enabled: boolean
    enabled_at: string | null
    settings: Record<string, unknown>
  }>
  changed: Array<{ feature_key: PharmacyFeatureKey; is_enabled: boolean }>
}

export default function FeaturesPage() {
  const { isEnabled, isLoading } = usePharmacyFeatures()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [changed, setChanged] = useState<FeaturesResponse['changed']>([])

  const {
    data: spSettings,
    isLoading: isSpSettingsLoading,
    error: spSettingsError,
  } = useQuery<{ configured: boolean }>({
    queryKey: ['sp-authorization-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/sp-authorization')
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Could not load superintendent settings.')
      return body
    },
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: async ({
      currentCode,
      change,
    }: {
      currentCode: string | null
      change: PendingChange
    }) => {
      const response = await fetch('/api/pharmacy/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...change.body, currentCode }),
      })
      const result = await response.json().catch(() => null) as FeaturesResponse | { error?: string } | null
      const errorMessage = result && 'error' in result ? result.error : null
      if (!response.ok) throw new Error(errorMessage || 'Could not update features')
      return result as FeaturesResponse
    },
    onSuccess: async result => {
      queryClient.setQueryData(['pharmacy-features'], { features: result.features })
      setChanged(result.changed ?? [])
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] })
    },
  })

  const requestChange = (change: PendingChange) => {
    setPending(change)
    if (spSettings?.configured === false) {
      mutation.mutate({ currentCode: null, change })
    }
  }

  if (isLoading || isSpSettingsLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (spSettingsError) {
    return (
      <p className="mx-auto mt-10 max-w-2xl text-sm font-medium text-danger" role="alert">
        {spSettingsError.message}
      </p>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <h1 className="mb-7 text-2xl font-medium text-ink">Settings</h1>
      <SettingsTabStrip active="features" />

      <header className="mt-8">
        <h2 className="text-3xl font-semibold text-ink">Features</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Start simple. Turn on only what your pharmacy uses. Turning a feature off never deletes its data.
        </p>
      </header>

      <section className="mt-7 rounded-feature border border-border bg-surface p-4 sm:p-6" aria-labelledby="presets-heading">
        <h2 id="presets-heading" className="text-lg font-semibold text-ink">Set up in one tap</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map(preset => (
            <button
              key={preset.key}
              type="button"
              disabled={mutation.isPending}
              onClick={() => requestChange({
                body: { preset: preset.key },
                description: `Apply the ${preset.name} feature set`,
              })}
              className="min-h-28 rounded-card border border-border bg-card p-4 text-left text-card-foreground shadow-xs hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="font-semibold">{preset.name}</span>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">{preset.detail}</span>
            </button>
          ))}
        </div>
        {changed.length > 0 && (
          <p className="mt-4 text-sm text-ink-muted" role="status">
            Updated {changed.length} features. You can adjust any card below.
          </p>
        )}
      </section>

      {(['SELLING', 'STOCK', 'PEOPLE', 'GROWTH'] as Group[]).map(group => (
        <section key={group} className="mt-9" aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className="text-xs font-bold tracking-[0.16em] text-ink-muted">{group}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.filter(feature => feature.group === group).map(feature => {
              const Icon = feature.icon
              const enabled = isEnabled(feature.key)
              const legallyBlocked = feature.key === 'stock_exchange'

              return (
                <article key={feature.key} className="flex min-h-64 flex-col rounded-feature border border-border bg-card p-5 text-card-foreground shadow-xs">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-ink">{feature.name}</h3>
                  <p className="mt-2 text-sm leading-5 text-ink-muted">{feature.benefit}</p>
                  <p className="mt-2 text-xs leading-5 text-ink-light">{feature.change}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    {enabled ? (
                      <>
                        <span className="rounded-badge bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">On</span>
                        {feature.settingsHref && (
                          <Link href={feature.settingsHref} className="px-2 py-2 text-sm font-medium text-primary">
                            Settings
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={mutation.isPending}
                          onClick={() => requestChange({
                            body: { feature_key: feature.key, is_enabled: false },
                            description: `Turn off ${feature.name}`,
                          })}
                        >
                          Turn off
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={legallyBlocked || mutation.isPending}
                        onClick={() => requestChange({
                          body: { feature_key: feature.key, is_enabled: true },
                          description: `Enable ${feature.name}`,
                        })}
                      >
                        {legallyBlocked ? 'Awaiting clearance' : 'Enable'}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}

      {mutation.error && (
        <p className="mt-6 text-sm font-medium text-danger" role="alert">
          {mutation.error.message}
        </p>
      )}

      <SpAuthorizationModal
        open={pending !== null && spSettings?.configured === true}
        mode="current-code"
        description={pending?.description ?? 'Change pharmacy features'}
        onAuthorized={async currentCode => {
          if (!pending) return false
          await mutation.mutateAsync({ currentCode, change: pending })
        }}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
