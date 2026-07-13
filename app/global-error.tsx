'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error) }, [error])
  return <html><body><main className="grid min-h-screen place-items-center p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Something went wrong</h1><p className="mt-2 text-sm text-ink-muted">The error has been recorded without personal health information.</p><Button className="mt-5" onClick={reset}>Try again</Button></div></main></body></html>
}
