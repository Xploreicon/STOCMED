import { Suspense } from 'react';
import PageContent from './page-content';

export default function Page() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-muted" role="status">Loading…</div>}><PageContent /></Suspense>;
}
