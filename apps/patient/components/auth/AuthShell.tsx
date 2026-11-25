import type { ReactNode } from 'react';
import { Check, MapPin, Pill, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

interface AuthShellProps {
  children: ReactNode;
  title: string;
  description: string;
  wide?: boolean;
  imageSrc?: string;
}

/** Shared presentation only: authentication and native OAuth remain in each page. */
export function AuthShell({ children, title, description, wide = false, imageSrc }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-white text-ink lg:grid lg:grid-cols-2">
      <aside className="sticky top-0 hidden h-screen overflow-hidden bg-surface px-12 py-12 lg:flex lg:flex-col xl:px-16" aria-label="About StocMed">
        {imageSrc ? (
          <>
            {/* Source image is optional so the shell works without a remote image dependency. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-dark/95 via-primary-dark/40 to-transparent" />
          </>
        ) : <Logo size={38} wordSize={22} href="/" />}
        <div className={cn("relative max-w-lg py-12", imageSrc ? "mt-auto" : "my-auto")}>
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white px-4 py-2 text-sm font-medium text-primary">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Medication search, closer to you
          </span>
          <h2 className={cn("font-display text-3xl font-semibold leading-tight tracking-tight text-navy xl:text-4xl", imageSrc && "text-white")}>
            Find the medication you need, at a pharmacy that has it.
          </h2>
          <p className={cn("mt-5 max-w-md text-base leading-7 text-ink-muted", imageSrc && "text-white/90")}>
            Search nearby pharmacies, compare available medicines, and keep track of your pickup holds in one place.
          </p>
          {!imageSrc && <div className="relative mt-8 hidden max-w-md rounded-3xl xl:block border border-white bg-white p-6 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Pill className="h-7 w-7" aria-hidden="true" />
              </div>
              <div>
                <p className="text-base font-semibold text-ink">Your next step, made clearer</p>
                <p className="mt-1 text-sm text-ink-muted">From finding stock to collecting your medicine.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-3 border-t border-border pt-5 text-sm text-ink-muted">
              {['Search by medicine or location', 'See pharmacy and collection details', 'Pay directly at the pharmacy'].map((item) => (
                <span key={item} className="flex items-center gap-3">
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>}
        </div>
        <p className={cn("relative flex items-center gap-2 text-sm text-ink-muted", imageSrc && "text-white/90")}>
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Your account, your searches, your next step.
        </p>
      </aside>
      <main className="flex min-w-0 flex-col px-5 py-8 sm:px-10 lg:min-h-screen lg:px-12 lg:py-12">
        <div className={cn('mx-auto my-auto w-full py-4 sm:py-8', wide ? 'max-w-xl' : 'max-w-md')}>
          <div className="mb-8 flex justify-center">
            <Logo size={42} wordSize={23} href="/" />
          </div>
          <div className="mb-8 text-center">
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{title}</h1>
            <p className="mt-3 text-[15px] leading-6 text-ink-muted">{description}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
