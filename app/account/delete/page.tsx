import Link from 'next/link';
import { ArrowLeft, Mail, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';

export const metadata = {
  title: 'Delete Your Account | StocMed',
  description: 'Instructions for requesting deletion of your StocMed account and associated personal data.',
};

const deletionEmail =
  'mailto:support@askstocmed.com?subject=Delete%20my%20StocMed%20account';

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-50 border-b border-border bg-white/[0.92] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size={32} />
            <span className="text-[18px] font-medium tracking-[-0.2px] text-ink">StocMed</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-12 sm:py-16">
        <div className="space-y-8 rounded-card-lg border border-border bg-white p-6 shadow-sm sm:p-10">
          <header className="space-y-3 border-b border-border pb-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10">
              <Trash2 className="h-6 w-6 text-danger" />
            </div>
            <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              Delete your StocMed account
            </h1>
            <p className="max-w-2xl text-[16px] leading-7 text-ink-muted">
              You can request deletion of your StocMed account and the personal data linked to it at
              any time.
            </p>
          </header>

          <section className="space-y-4" aria-labelledby="email-deletion-heading">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 id="email-deletion-heading" className="font-display text-xl font-semibold text-ink">
                  Request account deletion by email
                </h2>
                <p className="leading-7 text-ink-muted">
                  Email us from the address associated with your account and ask us to delete your
                  StocMed account and data. We may contact you to verify that the request is yours.
                </p>
              </div>
            </div>

            <a
              href={deletionEmail}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Email support@askstocmed.com
            </a>
          </section>

          <section className="space-y-4 border-t border-border pt-7" aria-labelledby="in-app-deletion-heading">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 id="in-app-deletion-heading" className="font-display text-xl font-semibold text-ink">
                  Delete linked data in the app
                </h2>
                <p className="leading-7 text-ink-muted">
                  Sign in, open <strong className="font-semibold text-ink">Settings</strong>, and select{' '}
                  <strong className="font-semibold text-ink">Delete my data</strong>. This removes or
                  anonymises linked search, chat, consent, intake, and reservation data. To close the
                  login account as well, send the email request above.
                </p>
              </div>
            </div>

            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Open StocMed Settings
            </Link>
          </section>

          <section className="space-y-3 rounded-card border border-border bg-surface p-5" aria-labelledby="data-heading">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 id="data-heading" className="font-display text-lg font-semibold text-ink">
                What happens to your data
              </h2>
            </div>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-ink-muted">
              <li>Your account profile and personal data linked to the account are deleted or anonymised.</li>
              <li>Anonymous aggregate demand records that cannot identify you may remain.</li>
              <li>
                Prescription records may be retained until an approved legal or safety retention period
                ends, after which eligible records and private files are removed.
              </li>
            </ul>
          </section>

          <p className="border-t border-border pt-6 text-sm leading-6 text-ink-muted">
            For more information about how StocMed handles personal data, read our{' '}
            <Link href="/privacy" className="font-semibold text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
