import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Privacy Policy | StocMed',
  description: 'StocMed Health Ltd Privacy Policy explaining data collection, demand insights, and user rights.',
};

export default function PrivacyPage() {
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

          <header className="border-b border-border pb-6">
            <h1 className="font-display font-medium text-3xl sm:text-4xl text-ink">PRIVACY POLICY</h1>
            <p className="text-sm font-semibold text-primary mt-2">Last updated: 1 September 2026</p>
          </header>

          <div className="prose prose-slate max-w-none space-y-6 text-[15px] sm:text-[16px] leading-[1.7] text-ink-muted">
            <p>
              StocMed Health Ltd (&ldquo;StocMed&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates askstocmed.com and the StocMed applications. This policy explains what information we collect, why, how we protect it, and the rights you have over it. We take this seriously because we handle health-related information.
            </p>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Who we are</h2>
              <p>
                StocMed Health Ltd is a private company limited by shares incorporated in Nigeria on 12 May 2026 (RC 9540156). Our registered address is 18 Anuoluwapo Street, Shomolu, Lagos State, Nigeria. For any privacy question or request, contact us at <strong>support@askstocmed.com</strong>.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">What we collect</h2>
              <p>
                <strong>When you create an account:</strong> your name, email address, phone number, and general location (the area or city you choose). If you register as a pharmacy, we also collect your pharmacy name, address, and PCN license number.
              </p>
              <p>
                <strong>When you search for medication:</strong> the text of your search and your general location, so we can show you nearby pharmacies that have what you need. We keep a record of your own searches so you can see your history.
              </p>
              <p>
                <strong>When you chat with our assistant:</strong> the messages you send, so the assistant can help you find medication. Your assistant messages are processed by Anthropic, a third-party AI provider (see &ldquo;Who we share with&rdquo;), solely to generate a response. Under Anthropic&apos;s standard commercial API terms, inputs and outputs are normally deleted from its systems within 30 days, subject to limited legal and safety exceptions, and are not used to train its models by default. The assistant does not diagnose or prescribe.
              </p>
              <p>
                <strong>When you allow location access:</strong> your device&apos;s location, used only to find pharmacies near you. You can decline this and enter your area manually instead. We do not track your location in the background.
              </p>
              <p>
                <strong>Automatically:</strong> basic technical information such as device type and browser, used to keep the service working and secure.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">What we do NOT do</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>We do <strong>not</strong> sell your personal identity to anyone.</li>
                <li>We do <strong>not</strong> process payments for your medicines. When you buy medication, you pay the pharmacy directly. Your card and payment details do not pass through StocMed.</li>
                <li>Our assistant does <strong>not</strong> diagnose you or prescribe medicine. It helps you find medication and, where appropriate, connects you to a licensed pharmacist or directs you to emergency care.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">How we use your information</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>To connect you with nearby pharmacies that stock the medication you need.</li>
                <li>To show you your own search history.</li>
                <li>To let a licensed pharmacist respond to a symptom enquiry or verify a prescription you submit.</li>
                <li>To keep the service secure and working properly.</li>
                <li>To understand, in an anonymous and aggregated way, what medications are in demand in different areas. This helps pharmacies stock what people need. <em>(See &ldquo;Demand insights&rdquo; below — this is separated from your identity.)</em></li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Demand insights, and how we protect your identity</h2>
              <p>
                We produce aggregate insights about which medications are being searched for in which areas. This is a core part of how StocMed helps pharmacies stock the right medicines.
              </p>
              <p>
                <strong>We do this in a way that separates the demand information from you personally.</strong> Your readable search history is kept in your own account so you can see it. The information that feeds our aggregate demand analytics is de-identified — it is not stored in a way that links a specific health-related query back to your named account. <em>(Technically: analytics search records are stored without your user identity attached; your personal history is stored separately under your own account and is only visible to you.)</em>
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Health-related information</h2>
              <p>Some of what you search for or discuss may relate to health. We treat this with extra care:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your personal chat and search history is visible only to you and to StocMed systems that need it to provide the service.</li>
                <li>Symptom enquiries and prescriptions you submit are viewed only by verified licensed pharmacists for the purpose of helping you.</li>
                <li>We apply additional protection to reduce the risk that health-related searches can be linked to your identity in our analytics.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Prescriptions you upload</h2>
              <p>
                If you upload a prescription, it is stored securely and privately and is accessible only to verified licensed pharmacists reviewing it. Prescription images are not publicly accessible.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">How long we keep your information</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your personal search history is retained for 12 months and then automatically deleted.</li>
                <li>Assistant message text stored by StocMed is retained for up to 30 days and then automatically deleted. An account-linked cryptographic hash used for integrity and abuse prevention may be retained for up to 12 months; it does not contain the readable message.</li>
                <li>Account information is kept while your account is active.</li>
              </ul>
              <p>You can delete your data at any time (see &ldquo;Your rights&rdquo;).</p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Who we share with</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Pharmacies:</strong> when you choose to contact or visit a pharmacy through StocMed, relevant details of your request are shared with that pharmacy so they can help you.</li>
                <li><strong>Delivery partners:</strong> if you choose delivery, the details needed to fulfil it are shared with the delivery provider. Payment and fulfilment are between you, the pharmacy, and the delivery provider — not StocMed.</li>
                <li>
                  <strong>Service providers (subprocessors):</strong> we use trusted third-party providers to run StocMed. They process data on our behalf, under agreement, and for the purposes below:
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    <li><strong>Supabase</strong> — database, authentication, and private-file hosting for account, search, pharmacy, inventory, and prescription data.</li>
                    <li><strong>Vercel</strong> — application hosting and delivery.</li>
                    <li><strong>Resend</strong> — sending transactional account and notification emails.</li>
                    <li><strong>Termii</strong> — sending SMS messages, such as reservation alerts, to the phone number you provide.</li>
                    <li><strong>Sentry</strong> — error and performance monitoring. Default personal-information collection is disabled and diagnostic events are scrubbed before transmission.</li>
                    <li><strong>Anthropic</strong> — provides the AI behind our in-app assistant and the tool that helps pharmacies organise medication inventory. When these features run, the relevant text — your assistant messages or a pharmacy&apos;s product list — is sent to Anthropic to generate a response or structure the inventory data. Under Anthropic&apos;s standard commercial API terms, API inputs and outputs are normally deleted within 30 days, subject to limited legal and safety exceptions, and are not used to train Anthropic&apos;s models by default unless StocMed explicitly opts in or submits the material as feedback.</li>
                  </ul>
                </li>
                <li><strong>Legal:</strong> we may disclose information where required by Nigerian law.</li>
              </ul>
              <p>We do not sell your personal data.</p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Your rights</h2>
              <p>Under the NDPR / Nigeria Data Protection Act, you have the right to:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Access</strong> the information we hold about you.</li>
                <li><strong>Correct</strong> information that is wrong.</li>
                <li><strong>Delete</strong> your data — the app includes a &ldquo;delete my data&rdquo; function that removes your search history, chat history, consent records, and related data. You can also contact us.</li>
                <li><strong>Withdraw consent</strong> for demand-insights use at any time, in your settings, without losing access to the core service.</li>
                <li><strong>Complain</strong> to the Nigeria Data Protection Commission if you believe we have mishandled your data.</li>
              </ul>
              <p>To exercise any of these, use the in-app controls or contact <strong>support@askstocmed.com</strong>.</p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Consent</h2>
              <p>
                When you first search, we ask for your explicit consent to use anonymised search patterns for demand insights. This is optional and revocable. Core search works whether or not you consent.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Security</h2>
              <p>
                We protect your data with access controls, encryption in transit, database-level security rules that keep each pharmacy&apos;s and each user&apos;s data separate, and monitoring. No system is perfectly secure, but we take reasonable measures appropriate to the sensitivity of the data.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Where your data is processed</h2>
              <p>
                Some of our service providers, including Anthropic, Vercel, Supabase, Resend, and Sentry, may process data outside Nigeria, including in the United States. When personal data is transferred abroad, we use contracts and other safeguards required by applicable Nigerian data-protection law and assess the protections provided by the recipient. Anthropic&apos;s standard commercial API retention and training terms are described above; any stronger contractual retention control will apply only when StocMed has confirmed it in writing with Anthropic.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Children</h2>
              <p>
                StocMed is intended for adults aged 18 and over. We do not knowingly collect personal data from anyone under 18. If you believe a person under 18 has provided personal data to us, contact us so we can investigate and take appropriate action.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-ink font-display">Changes</h2>
              <p>
                We may update this policy. We will post the new version here with an updated date and, for significant changes, notify you.
              </p>
            </section>

            <section className="space-y-3 border-t border-border pt-6">
              <h2 className="text-xl font-semibold text-ink font-display">Contact</h2>
              <p className="font-semibold text-ink">
                support@askstocmed.com &middot; 18 Anuoluwapo Street, Shomolu, Lagos State, Nigeria &middot; +234 (0) 800 STOCMED
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
