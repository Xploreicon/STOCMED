'use client'

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { PublicHeader } from '@/components/landing/PublicHeader';
import { PublicFooter } from '@/components/landing/PublicFooter';
import { PatientFaqSection } from '@/components/landing/PatientFaqSection';
import { ArrowRight, Banknote, MapPin, MessageCircle, PackageCheck, Search, type LucideIcon } from 'lucide-react';

const VALUE_PROPS = [
  { icon: MessageCircle, title: 'Ask in plain language', body: "Type a medicine or brand name — StocMed helps you search local names, generics, and dosages." },
  { icon: MapPin, title: 'Real-time, nearby stock', body: 'See exactly which pharmacies near you have it in stock right now — not a guess, a live inventory feed.' },
  { icon: Banknote, title: 'Compare prices instantly', body: 'Compare available pharmacy prices and distance to choose a convenient place to collect.' },
] satisfies Array<{ icon: LucideIcon; title: string; body: string }>;

const HOW_IT_WORKS = [
  { n: '01', icon: MessageCircle, title: 'Tell us what you need', body: 'Type a medication name or find a pharmacy for your prescription.' },
  { n: '02', icon: Search, title: 'See who has it', body: 'StocMed checks live inventory across nearby partner pharmacies and ranks results by distance and price.' },
  { n: '03', icon: PackageCheck, title: 'Reserve & go', body: "Reserve your medication so it's held for you, then walk in and pick it up." },
] satisfies Array<{ n: string; icon: LucideIcon; title: string; body: string }>;

export default function Landing() {
  const router = useRouter();
  const { user, profile, loading, error, refreshProfile, signOut } = useAuth();
  useEffect(() => {
    if (loading || !user || error) return;
    if (profile?.role === 'patient') router.replace(profile.location?.trim() ? '/dashboard' : '/profile?required=location');
    else if (!profile) router.replace('/complete-profile');
  }, [loading, user, profile, error, router]);

  return (
    <div className="w-full bg-white text-ink overflow-x-hidden">

      <PublicHeader />
      {user && error && <div role="alert" className="mx-auto my-5 max-w-[1200px] rounded-card border border-danger/20 bg-danger/5 p-5 text-sm text-danger"><p>Your account could not be checked. {error}</p><div className="mt-3 flex gap-5"><button type="button" className="font-medium underline" onClick={() => void refreshProfile()}>Retry account check</button><button type="button" className="font-medium underline" onClick={() => void signOut().catch(() => {})}>Sign out</button></div></div>}

      {/* HERO */}
      <section className="px-5 pt-12 pb-16 sm:px-6 sm:pt-16 sm:pb-20" style={{ background: 'linear-gradient(180deg, var(--surface) 0%, var(--white) 100%)' }}>
        <div className="mx-auto max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center">
          <div className="order-1">
            <div className="inline-flex items-center gap-2 bg-white border border-border rounded-full px-3.5 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[13px] font-medium text-ink-muted">Medication search for Nigeria</span>
            </div>
            <h1 className="font-display font-bold text-[36px] sm:text-[48px] lg:text-[56px] leading-[1.08] tracking-[-0.01em] text-ink max-w-[560px]">
              Find the medication you need, at a pharmacy that has it
            </h1>
            <p className="text-[18px] leading-[1.6] text-ink-muted max-w-[520px] mt-6">
              StocMed&apos;s AI checks real-time stock across pharmacies near you, compares prices, and tells you exactly where to go — before you leave the house.
            </p>
            <div className="flex flex-wrap gap-4 mt-9">
              <Link href="/signup" className="h-12 flex items-center justify-center px-7 bg-primary text-white text-[16px] font-medium rounded-button hover:bg-[var(--primary-hover)]">
                Find medication
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-10 border-t border-border pt-6">
              {[['Nearby', 'Find pharmacy stock'], ['Compare', 'Check available prices'], ['At pickup', 'Pay the pharmacy']].map(([n, l]) => (
                <div key={l}>
                  <div className="text-lg sm:text-xl font-semibold text-navy">{n}</div>
                  <div className="text-xs sm:text-sm text-ink-muted">{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual — live search result mock */}
          <div className="order-2">
            <div className="bg-white border border-border rounded-card-lg overflow-hidden shadow-lg">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Search className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </div>
                <span className="text-[14px] font-medium text-ink">Example search: a medication near Ikeja</span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3"><p className="text-xs text-ink-muted">Illustration only. Search to check current availability and prices.</p>
                {[
                  { name: 'MedPlus Pharmacy – Allen Avenue', meta: '1.2 km away · ₦1,200 / pack', label: 'In stock', cls: 'badge-success', dim: false },
                  { name: 'HealthPlus – Opebi Road', meta: '2.4 km away · ₦1,350 / pack', label: 'Low stock', cls: 'badge-warning', dim: false },
                  { name: 'Alpha Pharmacy – Toyin Street', meta: '1.8 km away', label: 'Out of stock', cls: 'badge-danger', dim: true },
                ].map((r) => (
                  <div key={r.name} className={`flex items-center justify-between p-3.5 border border-border rounded-card ${r.dim ? 'opacity-60' : ''}`}>
                    <div>
                      <div className="text-[15px] font-medium text-ink">{r.name}</div>
                      <div className="text-[13px] text-ink-light mt-0.5">{r.meta}</div>
                    </div>
                    <span className={`${r.cls} px-2.5 py-1.5 rounded-button whitespace-nowrap`}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="px-6 py-24 bg-white">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-[600px] mb-14">
            <h2 className="font-display font-semibold text-[30px] sm:text-[36px] leading-[1.2] text-ink">Built for how Nigerians actually find medication</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {VALUE_PROPS.map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="border border-border rounded-card p-8">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3 className="text-[19px] font-medium text-ink mb-2.5">{c.title}</h3>
                  <p className="text-[15px] leading-[1.6] text-ink-muted">{c.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="px-6 py-24 bg-surface">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="font-display font-semibold text-[30px] sm:text-[36px] text-ink mb-14 text-center">How it works</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((s) => {
              const Icon = s.icon
              return (
              <div key={s.n} className="bg-white border border-border rounded-card-lg px-7 py-9">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <span className="font-display font-medium text-[24px] text-primary">{s.n}</span>
                </div>
                <h3 className="text-[18px] font-medium text-ink mb-2.5">{s.title}</h3>
                <p className="text-[15px] leading-[1.6] text-ink-muted">{s.body}</p>
              </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* AI CHAT PREVIEW */}
      <section id="find" className="px-6 py-24 bg-white">
        <div className="mx-auto max-w-[1200px] grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-16 items-center">
          <div>
            <span className="text-[13px] font-medium text-primary uppercase tracking-[0.04em]">AI-powered search</span>
            <h2 className="font-display font-semibold text-[30px] sm:text-[36px] leading-[1.2] text-ink mt-3">Talk to StocMed like you would a pharmacist</h2>
            <p className="text-[16px] leading-[1.7] text-ink-muted mt-5 max-w-[440px]">
              Search by medicine name or ask a question in plain language. StocMed helps you find nearby pharmacy stock. A licensed pharmacist handles prescription review and clinical advice.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-card-lg p-2">
            <div className="bg-white rounded-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-[13px] font-medium text-ink-muted">StocMed Assistant</span>
              </div>
              <div className="px-5 py-6 flex flex-col gap-4 min-h-[280px]">
                <div className="self-end bg-primary text-white text-[15px] px-4 py-3 rounded-[12px_12px_2px_12px] max-w-[80%]">Where can I find my prescribed medicine near Ikeja?</div>
                <div className="self-start bg-surface text-ink text-[15px] leading-[1.55] px-4 py-3 rounded-[12px_12px_12px_2px] max-w-[85%]">Tell me the medicine name and strength. I can help you compare nearby pharmacies. Prescription medicines are reviewed by the pharmacy before a pickup hold is confirmed.</div>
                <div className="self-end bg-primary text-white text-[15px] px-4 py-3 rounded-[12px_12px_2px_12px] max-w-[80%]">Search nearby pharmacies</div>
                <div className="self-start flex items-center gap-1.5 px-4 py-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
              <div className="px-4 py-3 border-t border-border flex items-center gap-2.5">
                <div className="flex-1 h-11 border border-border rounded-button flex items-center px-3.5 text-xs sm:text-sm text-ink-muted">Ask about a medication…</div>
                <div className="w-11 h-11 rounded-button bg-primary flex items-center justify-center text-white">
                  <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <PatientFaqSection />

      <PublicFooter />
    </div>
  );
}
