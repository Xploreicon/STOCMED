'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { BellRing, ChevronRight, FileCheck2 } from 'lucide-react'
import type { Database } from '@/types/supabase'

type PharmacyProfile = Database['public']['Tables']['pharmacies']['Row']

type ReservationsSummary = {
  active_count: number
  unseen_count: number
  pending_prescriptions: number
}

async function getPharmacyProfile(): Promise<PharmacyProfile> {
  const response = await fetch('/api/pharmacy/profile')
  if (!response.ok) throw new Error('Failed to fetch pharmacy profile')
  return response.json()
}

async function getReservationsSummary(): Promise<ReservationsSummary> {
  const response = await fetch('/api/pharmacy/reservations/summary')
  if (!response.ok) throw new Error('Failed to fetch reservations summary')
  return response.json()
}

export function PharmacyReservationsBar() {
  const { data: pharmacyProfile } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: getPharmacyProfile,
  })

  const reservationsEnabled = pharmacyProfile?.reservations_enabled === true
  const { data: summary } = useQuery({
    queryKey: ['pharmacy-reservations-summary'],
    queryFn: getReservationsSummary,
    enabled: reservationsEnabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  const activeCount = summary?.active_count ?? 0
  const pendingPrescriptions = summary?.pending_prescriptions ?? 0
  const unseenCount = summary?.unseen_count ?? 0
  const totalWaiting = activeCount + pendingPrescriptions

  const holdLabel = `${activeCount} ${activeCount === 1 ? 'pickup hold' : 'pickup holds'}`
  const prescriptionLabel = `${pendingPrescriptions} ${pendingPrescriptions === 1 ? 'prescription review' : 'prescription reviews'}`
  const waitingLabel = activeCount > 0 && pendingPrescriptions > 0
    ? `${holdLabel} and ${prescriptionLabel} waiting`
    : `${activeCount > 0 ? holdLabel : prescriptionLabel} waiting`

  if (!reservationsEnabled || totalWaiting === 0) return null

  return (
    <Link
      href="/pharmacy/reservations"
      className="group relative z-40 flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary/25 bg-primary px-5 py-3 text-white shadow-sm transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:px-6 lg:px-8"
      aria-label={`${waitingLabel}${unseenCount > 0 ? `, ${unseenCount} new` : ''}. Open reservations queue.`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
          <BellRing className="h-5 w-5" aria-hidden="true" />
          {unseenCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-primary bg-white" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold sm:text-[15px]">
            {activeCount > 0 && <span>{holdLabel} waiting</span>}
            {activeCount > 0 && pendingPrescriptions > 0 && <span aria-hidden="true">&middot;</span>}
            {pendingPrescriptions > 0 && (
              <span className="inline-flex items-center gap-1">
                <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                {prescriptionLabel} pending
              </span>
            )}
            {unseenCount > 0 && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-primary">
                {unseenCount} new
              </span>
            )}
          </span>
          <span className="mt-0.5 hidden text-xs text-white/80 sm:flex sm:items-center sm:gap-2">
            <span>Open the queue to review or collect</span>
          </span>
        </span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-1 text-sm font-semibold">
        <span className="hidden sm:inline">View queue</span>
        <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  )
}
