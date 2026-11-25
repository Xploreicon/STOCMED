'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

const links = [
  { label: 'Home', href: '/' },
  { label: 'About us', href: '/about' },
  { label: 'FAQs', href: '/#faq' },
  { label: 'Contact', href: '/about#contact' },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur-md pt-[env(safe-area-inset-top)]">
    <div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-6 px-5 sm:px-6">
      <Logo size={38} wordSize={23} />
      <nav aria-label="Main navigation" className="hidden items-center gap-8 lg:flex">
        {links.map(link => <Link key={link.href} href={link.href} className="py-3 text-sm font-medium text-ink-muted hover:text-primary">{link.label}</Link>)}
      </nav>
      <div className="flex items-center gap-3">
        <Link href="/login" className="hidden min-h-11 items-center rounded-button px-5 text-sm font-semibold text-primary hover:bg-secondary sm:inline-flex">Log in</Link>
        <Link href="/signup" className="hidden min-h-11 items-center rounded-button bg-primary px-5 text-sm font-semibold text-white hover:bg-navy sm:inline-flex">Get started</Link>
        <button type="button" onClick={() => setOpen(value => !value)} className="flex h-11 w-11 items-center justify-center rounded-button text-primary hover:bg-secondary lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="public-mobile-menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
    </div>
    {open && <nav id="public-mobile-menu" aria-label="Mobile navigation" className="border-t border-border bg-white px-5 py-4 lg:hidden">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-1">
        {links.map(link => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-button px-3 py-3 text-sm font-medium text-ink hover:bg-secondary">{link.label}</Link>)}
        <Link href="/signup" onClick={() => setOpen(false)} className="mt-2 rounded-button bg-primary px-3 py-3 text-center text-sm font-semibold text-white">Find medication</Link>
        <Link href="/login" onClick={() => setOpen(false)} className="rounded-button px-3 py-3 text-center text-sm font-semibold text-primary">Log in</Link>
      </div>
    </nav>}
  </header>;
}
