import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, HeartPulse, ShieldCheck, Stethoscope, Syringe, type LucideIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'


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

export default async function PatientDashboard() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: userData } = await supabase
    .from('users')
    .select('full_name')
    .eq('user_id', user.id)
    .single()

  const { data: recentSearchesData } = await supabase
    .from('user_search_history')
    .select('id, query_text, location, searched_at, results_count')
    .eq('user_id', user.id)
    .order('searched_at', { ascending: false })
    .limit(3)

  type Row = {
    id: string
    query_text: string
    location: string | null
    searched_at: string
    results_count: number | null
  }

  const recent = ((recentSearchesData ?? []) as Row[]).map((s) => {
    const name = s.query_text
    const count = s.results_count ?? 0
    const dot = count === 0 ? 'bg-danger' : count <= 1 ? 'bg-warning' : 'bg-success'
    const meta =
      count === 0
        ? 'No pharmacies with stock nearby'
        : `${count} ${count === 1 ? 'pharmacy' : 'pharmacies'} with stock${s.location ? ` near ${s.location}` : ''}`
    return {
      id: s.id,
      name,
      meta,
      dot,
      when: formatDistanceToNow(new Date(s.searched_at), { addSuffix: true }),
      q: s.query_text,
    }
  })

  const firstName = (userData as { full_name?: string } | null)?.full_name?.split(' ')[0]
    || user.email?.split('@')[0]
    || 'there'

  return (
    <div className="w-full max-w-[760px] mx-auto">
      <h1 className="font-display font-medium text-[30px] text-ink">{greeting()}, {firstName}</h1>
      <p className="text-[15px] text-ink-muted mt-2">What are you looking for today?</p>

      {/* Chat launch */}
      <div className="mt-7 bg-surface border border-border rounded-card-lg p-6">
        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className="flex-1 h-[52px] bg-white border border-border rounded-button flex items-center px-4 text-[15px] text-ink-light min-w-0"
          >
            <span className="truncate">Ask about a medication or describe a symptom…</span>
          </Link>
          <Link
            href="/chat"
            className="w-[52px] h-[52px] flex-shrink-0 rounded-button bg-primary flex items-center justify-center text-white hover:bg-[var(--primary-hover)]"
            aria-label="Start chat search"
          >
            <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
        <p className="text-[13px] text-ink-muted mt-3">e.g. &ldquo;Where can I get Coartem near Yaba?&rdquo; or &ldquo;I have a fever and body pain&rdquo;</p>
      </div>

      {/* Recent searches */}
      {recent.length > 0 && (
        <div className="mt-10">
          <h2 className="text-[16px] font-medium text-ink mb-4">Recent searches</h2>
          <div className="border border-border rounded-card overflow-hidden divide-y divide-border">
            {recent.map((r) => (
              <Link
                key={r.id}
                href={`/chat?q=${encodeURIComponent(r.q)}`}
                className="flex items-center justify-between p-4 bg-white hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.dot}`} />
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-ink truncate">{r.name}</div>
                    <div className="text-[13px] text-ink-light mt-0.5 truncate">{r.meta}</div>
                  </div>
                </div>
                <span className="text-[13px] text-ink-light whitespace-nowrap ml-3">{r.when}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Suggested */}
      <div className="mt-10">
        <h2 className="text-[16px] font-medium text-ink mb-4">Suggested for you</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SUGGESTIONS.map((s) => (
            (() => {
              const Icon = s.icon
              return (
                <Link
                  key={s.label}
                  href={`/chat?q=${encodeURIComponent(s.q)}`}
                  className="border border-border rounded-card p-4 flex items-center gap-3 hover:border-primary/40 hover:bg-surface transition-colors"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-[14px] font-medium text-ink">{s.label}</span>
                </Link>
              )
            })()
          ))}
        </div>
      </div>
    </div>
  )
}
