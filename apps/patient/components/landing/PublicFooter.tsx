import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

export function PublicFooter() {
  const columns = [
    { title: 'For patients', links: [['Find medication', '/signup'], ['How it works', '/#how'], ['Patient FAQs', '/#faq-patients']] },
    { title: 'Company', links: [['About us', '/about'], ['Contact', '/about#contact'], ['Privacy policy', '/privacy'], ['Terms of service', '/terms']] },
  ];
  return <footer className="bg-navy px-5 pt-14 pb-7 text-white sm:px-6">
    <div className="mx-auto max-w-[1200px]">
      <div className="grid grid-cols-2 gap-9 pb-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1"><Logo size={38} wordSize={23} onDark /><p className="mt-4 max-w-64 text-sm leading-relaxed text-white/85">Find your medication nearby. Compare availability before you go.</p></div>
        {columns.map(column => <div key={column.title}><p className="mb-4 text-sm font-semibold">{column.title}</p><div className="flex flex-col gap-3">{column.links.map(([label, href]) => <Link key={href} href={href} className="w-fit py-1 text-sm text-white/85 hover:text-white hover:underline">{label}</Link>)}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/20 pt-6 text-xs text-white/85"><span>© {new Date().getFullYear()} StocMed. All rights reserved.</span><span>Lagos, Nigeria</span></div>
    </div>
  </footer>;
}
