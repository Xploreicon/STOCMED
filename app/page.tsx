import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LogoMark } from '@/components/brand/Logo';
import { FaqSection } from '@/components/landing/FaqSection';
import { ArrowRight, Banknote, MapPin, MessageCircle, PackageCheck, Search, type LucideIcon } from 'lucide-react';

const VALUE_PROPS = [
  { icon: MessageCircle, title: 'Ask in plain language', body: "Describe your symptom or type a brand name — StocMed's AI understands local names, generics, and dosages." },
  { icon: MapPin, title: 'Real-time, nearby stock', body: 'See exactly which pharmacies near you have it in stock right now — not a guess, a live inventory feed.' },
  { icon: Banknote, title: 'Compare prices instantly', body: 'Prices vary a lot between pharmacies. StocMed shows you the cheapest option within your reach.' },
] satisfies Array<{ icon: LucideIcon; title: string; body: string }>;

const HOW_IT_WORKS = [
  { n: '01', icon: MessageCircle, title: 'Tell us what you need', body: 'Type a medication name, upload a prescription photo, or describe your symptom.' },
  { n: '02', icon: Search, title: 'See who has it', body: 'StocMed checks live inventory across nearby partner pharmacies and ranks results by distance and price.' },
  { n: '03', icon: PackageCheck, title: 'Reserve & go', body: "Reserve your medication so it's held for you, then walk in and pick it up." },
] satisfies Array<{ n: string; icon: LucideIcon; title: string; body: string }>;

export default async function Landing() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const role = user.user_metadata?.role;
    if (role === 'pharmacy') {
      redirect('/pharmacy/dashboard');
    } else {
      redirect('/dashboard');
    }
  }

  return (
    <div className="w-full bg-white text-ink overflow-x-hidden">

      {/* NAV */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/[0.92] backdrop-blur-md">
        <div className="mx-auto max-w-[1200px] px-6 py-4 flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size={32} />
            <span className="text-[18px] font-medium text-ink tracking-[-0.2px]">StocMed</span>
          </Link>
          <nav className="hidden lg:flex items-center gap-8">
            <a href="#find" className="text-[15px] text-ink-muted hover:text-ink">Find medication</a>
            <a href="#pharmacy" className="text-[15px] text-ink-muted hover:text-ink">For pharmacies</a>
            <a href="#how" className="text-[15px] text-ink-muted hover:text-ink">How it works</a>
            <a href="#faq" className="text-[15px] text-ink-muted hover:text-ink">FAQ</a>
            <Link href="/about" className="text-[15px] text-ink-muted hover:text-ink">About</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-[15px] font-medium text-primary px-4 py-2.5">Sign in</Link>
            <Link
              href="/signup?role=patient"
              className="h-11 flex items-center px-5 bg-primary text-white text-[15px] font-medium rounded-button whitespace-nowrap hover:bg-[var(--primary-hover)]"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="px-6 pt-20 pb-24" style={{ background: 'linear-gradient(180deg, var(--surface) 0%, var(--white) 100%)' }}>
        <div className="mx-auto max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-16 items-center">
          <div className="order-2 lg:order-1">
            <div className="inline-flex items-center gap-2 bg-white border border-border rounded-full px-3.5 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[13px] font-medium text-ink-muted">Live across 1,200+ pharmacies in Lagos, Abuja &amp; Port Harcourt</span>
            </div>
            <h1 className="font-display font-medium text-[40px] lg:text-[56px] leading-[1.08] tracking-[-0.01em] text-ink max-w-[560px]">
              Find the medication you need, at a pharmacy that has it
            </h1>
            <p className="text-[18px] leading-[1.6] text-ink-muted max-w-[520px] mt-6">
              StocMed&apos;s AI checks real-time stock across pharmacies near you, compares prices, and tells you exactly where to go — before you leave the house.
            </p>
            <div className="flex flex-wrap gap-4 mt-9">
              <Link href="/signup?role=patient" className="h-12 flex items-center justify-center px-7 bg-primary text-white text-[16px] font-medium rounded-button hover:bg-[var(--primary-hover)]">
                Find medication
              </Link>
              <Link href="/signup?role=pharmacy" className="h-12 flex items-center justify-center px-7 bg-white text-primary border-[1.5px] border-primary text-[16px] font-medium rounded-button hover:bg-surface">
                I&apos;m a pharmacy
              </Link>
            </div>
            <div className="flex gap-8 mt-12">
              {[['1,200+', 'Pharmacies connected'], ['40,000+', 'Medications tracked'], ['<2 min', 'Average search time']].map(([n, l]) => (
                <div key={l}>
                  <div className="text-[28px] font-medium text-navy">{n}</div>
                  <div className="text-[14px] text-ink-light">{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual — live search result mock */}
          <div className="order-1 lg:order-2">
            <div className="bg-white border border-border rounded-card-lg overflow-hidden shadow-lg">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Search className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </div>
                <span className="text-[14px] font-medium text-ink">Searching &ldquo;Amoxicillin 500mg&rdquo; near Ikeja</span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3">
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
            <h2 className="font-display font-medium text-[36px] leading-[1.2] text-ink">Built for how Nigerians actually find medication</h2>
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
          <h2 className="font-display font-medium text-[36px] text-ink mb-14 text-center">How it works</h2>
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
            <h2 className="font-display font-medium text-[36px] leading-[1.2] text-ink mt-3">Talk to StocMed like you would a pharmacist</h2>
            <p className="text-[16px] leading-[1.7] text-ink-muted mt-5 max-w-[440px]">
              No need to know the exact drug name. Describe how you feel, and StocMed suggests the right medication, checks dosage safety, and finds it nearby — in seconds.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-card-lg p-2">
            <div className="bg-white rounded-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-[13px] font-medium text-ink-muted">StocMed Assistant</span>
              </div>
              <div className="px-5 py-6 flex flex-col gap-4 min-h-[280px]">
                <div className="self-end bg-primary text-white text-[15px] px-4 py-3 rounded-[12px_12px_2px_12px] max-w-[80%]">I have a bad headache and slight fever, what should I take?</div>
                <div className="self-start bg-surface text-ink text-[15px] leading-[1.55] px-4 py-3 rounded-[12px_12px_12px_2px] max-w-[85%]">That sounds like it could be managed with Paracetamol 500mg. Would you take a quick clerking form so a pharmacy validates before pointing you to the pharmacies near you?</div>
                <div className="self-end bg-primary text-white text-[15px] px-4 py-3 rounded-[12px_12px_2px_12px] max-w-[80%]">Yes please</div>
                <div className="self-start flex items-center gap-1.5 px-4 py-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
              <div className="px-4 py-3 border-t border-border flex items-center gap-2.5">
                <div className="flex-1 h-11 border border-border rounded-button flex items-center px-3.5 text-[14px] text-ink-light">Ask about a medication or symptom…</div>
                <div className="w-11 h-11 rounded-button bg-primary flex items-center justify-center text-white">
                  <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PHARMACY CTA BAND */}
      <section id="pharmacy" className="bg-navy px-6 py-20">
        <div className="mx-auto max-w-[1200px] flex flex-wrap items-center justify-between gap-12">
          <div className="max-w-[560px]">
            <div className="flex items-center gap-2 mb-6">
              <LogoMark size={28} onDark />
              <span className="text-[16px] font-medium text-white tracking-[-0.2px]">StocMed</span>
            </div>
            <span className="text-[13px] font-medium uppercase tracking-[0.04em]" style={{ color: 'var(--primary-light)' }}>For pharmacies</span>
            <h2 className="font-display font-medium text-[28px] lg:text-[34px] leading-[1.25] text-white mt-3">List your inventory. Reach patients searching for stock right now.</h2>
            <p className="text-[16px] leading-[1.6] mt-4" style={{ color: 'var(--receipt-border)' }}>
              Join 1,200+ pharmacies already using StocMed to manage inventory and get discovered by nearby patients.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/signup?role=pharmacy" className="h-12 flex items-center justify-center px-7 bg-primary text-white text-[16px] font-medium rounded-button whitespace-nowrap hover:bg-[var(--primary-hover)]">
              Register your pharmacy
            </Link>
            <a href="#find" className="h-12 flex items-center justify-center px-7 bg-transparent text-white text-[16px] font-medium rounded-button whitespace-nowrap" style={{ border: '1.5px solid var(--muted-blue)' }}>
              Learn more
            </a>
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <FaqSection />

      {/* FOOTER */}
      <footer className="bg-white px-6 pt-16 pb-8 border-t border-border">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-8 pb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <LogoMark size={28} />
                <span className="text-[18px] font-medium text-ink tracking-[-0.2px]">StocMed</span>
              </div>
              <p className="text-[14px] text-ink-light leading-[1.6] max-w-[260px]">AI-powered medication search and pharmacy inventory for Nigeria.</p>
            </div>
            {[
              {
                h: 'Patients',
                links: [
                  ['Find medication', '/signup?role=patient'],
                  ['How it works', '#how'],
                  ['Patient FAQ', '#faq-patients'],
                  ['Safety & credentials', '/about#credentials'],
                ],
              },
              {
                h: 'Pharmacies',
                links: [
                  ['Register pharmacy', '/signup?role=pharmacy'],
                  ['Pharmacy Till / Login', '/login'],
                  ['Pharmacy FAQ', '#faq-pharmacies'],
                  ['Features & pricing', '#pharmacy'],
                ],
              },
              {
                h: 'Company',
                links: [
                  ['About StocMed', '/about'],
                  ['Contact us', '/about#contact'],
                  ['Privacy policy', '/privacy'],
                  ['Terms of service', '/terms'],
                ],
              },
            ].map((col) => (
              <div key={col.h}>
                <div className="text-[13px] font-medium text-ink mb-4">{col.h}</div>
                <div className="flex flex-col gap-3">
                  {col.links.map(([label, href]) => (
                    <Link key={label} href={href} className="text-[14px] text-ink-muted hover:text-ink font-normal">{label}</Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-border">
            <span className="text-[13px] text-ink-light">© 2026 StocMed Health Ltd. All rights reserved.</span>
            <div className="flex items-center gap-6 text-[13px] text-ink-light">
              <Link href="/privacy" className="hover:text-ink">Privacy</Link>
              <Link href="/terms" className="hover:text-ink">Terms</Link>
              <span>Lagos, Nigeria</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
