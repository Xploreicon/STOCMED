'use client';

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, Clock3, Search, HeartPulse, ShieldCheck, Stethoscope, Syringe, type LucideIcon } from 'lucide-react'
import { recordedSearchSummary, repeatSearchHref } from '../history/history-utils'



const SUGGESTIONS = [
  { icon: Stethoscope, label: 'Malaria treatment', q: 'Malaria treatment' },
  { icon: HeartPulse, label: 'Blood pressure medication', q: 'Blood pressure medication' },
  { icon: ShieldCheck, label: 'Prenatal vitamins', q: 'Prenatal vitamins' },
  { icon: Syringe, label: 'Diabetes management', q: 'Diabetes management' },
] satisfies Array<{ icon: LucideIcon; label: string; q: string }>

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

type SearchRow = {
  id: string
  query_text: string
  location: string | null
  searched_at: string
  results_count: number | null
}

export default function PatientDashboard() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const [recentSearchesData, setRecentSearchesData] = useState<SearchRow[]>([])
  const [recentError, setRecentError] = useState<string | null>(null)
  const [recentLoading, setRecentLoading] = useState(true)
  const userId = user?.id

  useEffect(() => {
    if (!loading && profile && !profile.location?.trim()) {
      router.replace('/profile?required=location')
    }
  }, [loading, profile, router])

  const loadRecent = useCallback(async () => {
    if (!userId) return
    setRecentLoading(true)
    setRecentError(null)
    try {
      const { data, error } = await createClient()
        .from('user_search_history')
        .select('id, query_text, location, searched_at, results_count')
        .eq('user_id', userId)
        .order('searched_at', { ascending: false })
        .limit(3)
      if (error) throw error
      setRecentSearchesData((data ?? []) as SearchRow[])
    } catch {
      setRecentError('Your recent searches could not be loaded. Please try again.')
    } finally {
      setRecentLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  if (loading || !user || !profile?.location?.trim()) {
    return <div className="p-6 text-sm text-ink-muted" role="status">Loading your dashboard…</div>
  }

  const userProfile = profile
  const recent = (recentSearchesData ?? []).map((s) => {
    const name = s.query_text
    return {
      id: s.id,
      name,
      meta: recordedSearchSummary(s.results_count, s.location),
      href: repeatSearchHref(s.query_text, s.location),
      when: formatDistanceToNow(new Date(s.searched_at), { addSuffix: true }),
    }
  })

  const firstName = userProfile.full_name?.split(' ')[0]
    || user.email?.split('@')[0]
    || 'there'

  return (
    <div className="w-full max-w-[1100px] mx-auto space-y-7">
      <div>
        <h1 className="font-display font-semibold text-[25px] sm:text-[30px] text-ink">{greeting()}, {firstName}</h1>
        <p className="text-sm text-ink-muted mt-1.5">What are you looking for today?</p>
      </div>

      {/* Chat launch */}
      <section className="bg-white border border-border rounded-card p-5 sm:p-6" aria-labelledby="find-medicine-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="find-medicine-heading" className="text-base font-semibold text-ink">Find a medicine near you</h2><Link href="/chat" data-tour="patient-search-entry" className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">Open chat search <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
        <form action="/chat" method="get" className="flex items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <label htmlFor="dashboard-medication" className="sr-only">Medicine or symptom</label>
            <input
              id="dashboard-medication"
              name="q"
              type="search"
              required
              placeholder="Ask about a medication or describe a symptom…"
              className="w-full h-12 bg-white border border-border rounded-button pl-10 pr-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="submit"
            className="h-12 px-4 flex-shrink-0 gap-2 rounded-button bg-primary flex items-center justify-center text-sm font-semibold text-white hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label="Start chat search"
          >
            <span className="hidden sm:inline">Search</span><ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {['Where can I get Coartem near Yaba?', 'I have a fever and body pain'].map((prompt) => (
            <Link key={prompt} href={repeatSearchHref(prompt)} className="rounded-full bg-surface px-3 py-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{prompt}</Link>
          ))}
        </div>
      </section>

      {recentLoading && <p className="text-sm text-ink-muted" role="status">Loading recent searches…</p>}
      {recentError && <div className="rounded-card border border-border bg-white p-5 text-sm" role="alert"><p className="text-ink-muted">{recentError}</p><button type="button" onClick={() => void loadRecent()} className="mt-2 min-h-11 font-semibold text-primary">Try again</button></div>}

      {/* Recent searches */}
      {recent.length > 0 && (
        <section className="rounded-card border border-border bg-white p-5 sm:p-6" aria-labelledby="recent-searches-heading">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 id="recent-searches-heading" className="text-base font-semibold text-ink">Your recent searches</h2>
            <Link href="/history" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline">See all <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <p className="mb-3 text-xs text-ink-muted">Recorded results from earlier searches. Search again to check current availability.</p>
          <div className="divide-y divide-border">
            {recent.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 py-4 bg-white hover:bg-surface transition-colors rounded-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Clock3 className="h-5 w-5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-ink truncate">{r.name}</div>
                    <div className="text-[13px] text-ink-muted mt-1">{r.meta}</div>
                  </div>
                </div>
                <div className="ml-8 sm:ml-auto flex items-center gap-4">
                  <span className="text-xs text-ink-muted whitespace-nowrap">{r.when}</span>
                  <span className="rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary whitespace-nowrap">Search again</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Suggested */}
      <section aria-labelledby="common-searches-heading">
        <h2 id="common-searches-heading" className="text-base font-semibold text-ink mb-4">Common searches</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {SUGGESTIONS.map((s) => (
            (() => {
              const Icon = s.icon
              return (
                <Link
                  key={s.label}
                  href={`/chat?q=${encodeURIComponent(s.q)}`}
                  className="border border-border bg-white rounded-card p-4 flex flex-col items-start gap-3 hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-medium text-ink">{s.label}</span>
                </Link>
              )
            })()
          ))}
        </div>
      </section>
    </div>
  )
}
