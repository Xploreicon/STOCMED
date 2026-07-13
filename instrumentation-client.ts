import * as Sentry from '@sentry/nextjs'
import { scrub } from '@/lib/observability'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  beforeSend: (event) => scrub(event),
  beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
