import * as Sentry from '@sentry/nextjs'
import { scrub } from '@/lib/observability'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrub(event),
  beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
})
