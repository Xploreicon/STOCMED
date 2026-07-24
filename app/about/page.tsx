import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  HeartHandshake,
  ShieldCheck,
  Stethoscope,
  Users,
  Building2,
  Mail,
  MapPin,
  Phone,
} from 'lucide-react';

export const metadata = {
  title: 'About Us | StocMed',
  description:
    'Learn about StocMed Health Ltd, our mission, founding pharmacist team, credentials, and ACPN endorsement.',
};

const CREDENTIALS = [
  {
    title: 'ACPN National Chairman Endorsement',
    org: 'Association of Community Pharmacists of Nigeria',
    desc: 'Officially recognized and endorsed by the ACPN leadership for empowering community practice and patient access.',
    icon: ShieldCheck,
  },
  {
    title: 'FATE Foundation i2M',
    org: 'Innovation to Market Fellow',
    desc: 'Selected for top-tier health innovation and commercialization backing in Nigeria.',
    icon: Award,
  },
  {
    title: 'S-VCG Top 65',
    org: 'Venture Capital & Growth Selection',
    desc: 'Recognized among the top 65 high-impact technology ventures building for African health systems.',
    icon: Award,
  },
  {
    title: 'Hackaholics Top 10',
    org: 'Wema Bank Health-Tech Finalist',
    desc: 'Awarded top 10 finalist status for outstanding healthcare accessibility technology.',
    icon: Award,
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/[0.92] backdrop-blur-md">
        <div className="mx-auto max-w-[1100px] px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size={32} />
            <span className="text-[18px] font-medium text-ink tracking-[-0.2px]">StocMed</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink font-medium">
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* HERO / MISSION */}
      <section className="bg-white border-b border-border px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-[1000px] text-center space-y-6">
          <div className="inline-flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-1.5 shadow-sm">
            <Stethoscope className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">
              Built by Pharmacists &amp; Engineers
            </span>
          </div>
          <h1 className="font-display font-medium text-3xl sm:text-5xl text-ink leading-[1.15] max-w-[760px] mx-auto">
            Ensuring no Nigerian walks from pharmacy to pharmacy in vain.
          </h1>
          <p className="text-base sm:text-lg text-ink-muted leading-relaxed max-w-[680px] mx-auto">
            StocMed is an AI-powered medication search engine and unified inventory management system built specifically for the Nigerian healthcare ecosystem.
          </p>
        </div>
      </section>

      {/* MAIN STORY CONTENT */}
      <main className="mx-auto max-w-[1000px] px-6 py-16 space-y-16">
        {/* WHAT STOCMED IS */}
        <section className="bg-white border border-border rounded-card-lg p-8 sm:p-12 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="font-display font-medium text-2xl text-ink">What is StocMed?</h2>
          </div>
          <p className="text-base text-ink-muted leading-relaxed">
            StocMed bridges the critical gap between patients looking for essential medicines and community pharmacies that stock them. By connecting live pharmacy point-of-sale inventory directly to patient search, we eliminate wasted trips, enable transparent price comparison, and protect patients from counterfeit drugs.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-border/60">
            <div className="space-y-1.5">
              <div className="font-display text-2xl font-bold text-primary">3,289+</div>
              <div className="text-xs text-ink-muted">NAFDAC-Verified Catalogue Products Seeded</div>
            </div>
            <div className="space-y-1.5">
              <div className="font-display text-2xl font-bold text-primary">1,200+</div>
              <div className="text-xs text-ink-muted">Community Pharmacies Supported</div>
            </div>
            <div className="space-y-1.5">
              <div className="font-display text-2xl font-bold text-primary">1 Till</div>
              <div className="text-xs text-ink-muted">Unified Medicines &amp; Frontstore POS</div>
            </div>
          </div>
        </section>

        {/* FOUNDING TEAM */}
        <section className="bg-white border border-border rounded-card-lg p-8 sm:p-12 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="font-display font-medium text-2xl text-ink">The Founding Team</h2>
          </div>
          <p className="text-base text-ink-muted leading-relaxed">
            StocMed was founded by practicing pharmacists and software engineers who have lived the daily realities of Nigerian community pharmacy. We know the pain of stock-outs, expiring drugs, and manual ledger reconciliations. We built StocMed from the ground up to solve these frontline operational challenges while safeguarding patient health.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {[
              'Licensed Pharmacists with Pharmacists Council of Nigeria (PCN) credentials',
              'Software Architecture experts building offline-first PWA till systems',
              'Deep experience in NAFDAC Greenbook regulation & pharmaceutical data spine',
              'Direct partnership with community pharmacy owners across Lagos, Abuja & Port Harcourt',
            ].map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-sm text-ink-muted">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* CREDENTIALS & RECOGNITION */}
        <section id="credentials" className="space-y-8 scroll-mt-24">
          <div className="text-center max-w-[600px] mx-auto space-y-2">
            <h2 className="font-display font-medium text-3xl text-ink">Credentials &amp; Recognition</h2>
            <p className="text-sm text-ink-muted">
              Endorsed and recognized by industry leaders across pharmacy practice and technology innovation.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {CREDENTIALS.map((cred, idx) => {
              const Icon = cred.icon;
              return (
                <div key={idx} className="bg-white border border-border rounded-card p-6 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink text-base">{cred.title}</h3>
                      <p className="text-xs text-primary font-medium">{cred.org}</p>
                    </div>
                  </div>
                  <p className="text-sm text-ink-muted leading-relaxed">{cred.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CONTACT & OFFICE */}
        <section id="contact" className="bg-white border border-border rounded-card-lg p-8 sm:p-12 shadow-sm space-y-6 scroll-mt-24">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <h2 className="font-display font-medium text-2xl text-ink">Get in Touch</h2>
          </div>
          <p className="text-base text-ink-muted leading-relaxed">
            Whether you are a pharmacy owner wanting to list your stock, a partner looking to collaborate, or a patient with questions, our team is here for you.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-border/60">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary shrink-0 mt-1" />
              <div>
                <div className="text-xs font-semibold text-ink-muted uppercase">Email</div>
                <a href="mailto:hello@askstocmed.com" className="text-sm font-medium text-primary hover:underline">
                  hello@askstocmed.com
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-1" />
              <div>
                <div className="text-xs font-semibold text-ink-muted uppercase">Location</div>
                <div className="text-sm font-medium text-ink">Lagos, Nigeria</div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-primary shrink-0 mt-1" />
              <div>
                <div className="text-xs font-semibold text-ink-muted uppercase">Support</div>
                <div className="text-sm font-medium text-ink">+234 (0) 800 STOCMED</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-border px-6 py-8">
        <div className="mx-auto max-w-[1000px] flex flex-wrap items-center justify-between gap-4 text-xs text-ink-muted">
          <div>&copy; 2026 StocMed Health Ltd. All rights reserved.</div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-ink">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-ink">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
