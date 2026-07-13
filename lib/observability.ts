import * as Sentry from '@sentry/nextjs'

const sensitiveKey = /authorization|cookie|password|token|email|phone|name|address|query|message|content|symptom|prescription|location/i

export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key, sensitiveKey.test(key) ? '[REDACTED]' : scrub(entry),
    ])) as T
  }
  return value
}

type LogContext = Record<string, string | number | boolean | null | undefined>

export const logger = {
  info(event: string, context: LogContext = {}) {
    Sentry.addBreadcrumb({ category: 'application', level: 'info', message: event, data: scrub(context) })
  },
  warn(event: string, context: LogContext = {}) {
    Sentry.addBreadcrumb({ category: 'application', level: 'warning', message: event, data: scrub(context) })
  },
  error(event: string, error?: unknown, context: LogContext = {}) {
    Sentry.withScope((scope) => {
      scope.setTag('event', event)
      scope.setContext('context', scrub(context))
      Sentry.captureException(error instanceof Error ? error : new Error(event))
    })
  },
}
