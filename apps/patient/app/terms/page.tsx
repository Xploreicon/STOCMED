import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

export const metadata = {
  title: 'Terms of Service | StocMed',
  description: 'StocMed Health Ltd Terms of Service governing platform usage for patients and pharmacies.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/[0.92] backdrop-blur-md">
        <div className="mx-auto max-w-[1000px] px-6 py-4 flex items-center justify-between">
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

      {/* CONTENT CONTAINER */}
      <main className="mx-auto max-w-[900px] px-6 py-12">
        <div className="bg-white border border-border rounded-card-lg p-6 sm:p-12 shadow-sm space-y-8">

          {/* DRAFT NOTICE BANNER */}
          <div className="rounded-card border border-amber-300 bg-amber-50 p-5 text-amber-900 text-sm leading-relaxed space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-950 text-base">
              <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
              IMPORTANT — READ BEFORE PUBLISHING
            </div>
            <p>
              These drafts are written to accurately reflect what StocMed&apos;s system actually does with data, based on the platform as built. They are <strong>plain-language and honest</strong>, which is more defensible than generic boilerplate. <strong>However, they are NOT a substitute for legal review.</strong> Before you scale past the pilot, have a lawyer familiar with Nigerian data-protection law (NDPR / the Nigeria Data Protection Act 2023) and pharmacy regulation (PCN) review and finalise these. Fill every <code>[BRACKETED]</code> placeholder with your real details.
            </p>
          </div>

          <header className="border-b border-border pb-6">
            <h1 className="font-display font-medium text-3xl sm:text-4xl text-ink">TERMS OF SERVICE</h1>
            <p className="text-sm font-semibold text-primary mt-2">Last updated: [DATE]</p>
          </header>

          <div className="prose prose-slate max-w-none space-y-6 text-[15px] sm:text-[16px] leading-[1.7] text-ink-muted">
            <p>
              Welcome to StocMed. These terms govern your use of askstocmed.com and the StocMed applications. By using StocMed, you agree to them.
            </p>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">1. What StocMed is</h2>
              <p>
                StocMed is a platform that helps patients find medications at nearby pharmacies and helps pharmacies manage their inventory and sales. <strong>StocMed is a technology service, not a pharmacy, not a healthcare provider, and not a payment processor.</strong>
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">2. What StocMed is not — important health notice</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  StocMed does <strong>not</strong> provide medical advice, diagnosis, or treatment. Information provided through the platform, including via our assistant, is to help you locate medication and is not a substitute for professional medical advice.
                </li>
                <li>
                  <strong>Always consult a qualified doctor or pharmacist</strong> about your health and before taking any medication.
                </li>
                <li>
                  In an emergency, contact emergency services immediately (in Nigeria, <strong>112</strong>) or go to the nearest hospital. Do not rely on StocMed in an emergency.
                </li>
                <li>
                  Prescription-only medicines require a valid prescription. StocMed does not enable you to obtain prescription-only medicines without appropriate verification.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">3. Payments and purchases</h2>
              <p>
                StocMed does <strong>not</strong> process payments for medicines. Any purchase of medication is a transaction <strong>directly between you and the pharmacy</strong>. Prices shown are provided by pharmacies and may change; StocMed does not guarantee price or availability. Any delivery is provided by a third-party delivery partner, and payment and fulfilment are between you, the pharmacy, and that partner.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">4. Accounts</h2>
              <p>
                You are responsible for the accuracy of the information you provide and for keeping your login secure. You must be at least [AGE] years old to use StocMed. Pharmacies must be validly registered with the PCN and are responsible for the accuracy of their inventory, pricing, and licensing information.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">5. Acceptable use</h2>
              <p>
                You agree not to misuse StocMed, including not to: use it for any unlawful purpose; attempt to obtain restricted or prescription-only medicines improperly; interfere with or attempt to breach the platform&apos;s security; or submit false information.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">6. For pharmacies</h2>
              <p>
                Pharmacies using StocMed&apos;s inventory, point-of-sale, and related tools agree to: maintain valid PCN registration; keep inventory and pricing accurate; comply with all applicable pharmacy and drug regulations; and use the platform only for lawful pharmacy operations. [ADD subscription/freemium terms, data ownership, and termination provisions once finalised — this section needs legal input on the commercial relationship.]
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">7. Accuracy and availability</h2>
              <p>
                We work to keep information accurate and the service available, but we do not guarantee that stock information, prices, or pharmacy details are always complete or error-free, or that the service will be uninterrupted. Always confirm with the pharmacy.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">8. Limitation of liability</h2>
              <p>
                To the fullest extent permitted by Nigerian law, StocMed is not liable for decisions made based on information from the platform, for the acts of pharmacies or delivery partners, or for indirect or consequential losses. Nothing in these terms excludes liability that cannot lawfully be excluded. [LEGAL REVIEW REQUIRED — this clause must be drafted/confirmed by a lawyer.]
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">9. Intellectual property</h2>
              <p>
                StocMed and its content, branding, and software are owned by StocMed Health Ltd and may not be copied or reused without permission.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">10. Changes and termination</h2>
              <p>
                We may update these terms or the service, and may suspend accounts that breach them. We will post updated terms here.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">11. Governing law</h2>
              <p>
                These terms are governed by the laws of the Federal Republic of Nigeria. [CONFIRM dispute-resolution venue with legal.]
              </p>
            </section>

            <section className="space-y-3 border-t border-border pt-6">
              <h2 className="text-xl font-semibold text-ink font-display">12. Contact</h2>
              <p className="font-semibold text-ink">
                [SUPPORT EMAIL] &middot; [ADDRESS] &middot; [PHONE]
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
