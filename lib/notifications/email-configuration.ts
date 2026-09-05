const REQUIRED_EMAIL_CONFIGURATION = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'NOTIFICATION_HASH_PEPPER',
  'NOTIFICATION_SIGNING_SECRET',
] as const

type EmailConfigurationEnvironment = Record<string, string | undefined>

function usesVerifiedStocMedDomain(from: string) {
  const bracketed = from.match(/<([^>]+)>/)?.[1]
  const email = (bracketed || from).trim().toLowerCase()
  return email.endsWith('@askstocmed.com')
}

export function getEmailDeliveryConfiguration(
  environment: EmailConfigurationEnvironment = process.env,
) {
  const missing = REQUIRED_EMAIL_CONFIGURATION.filter(
    key => !environment[key]?.trim(),
  )
  const from = environment.RESEND_FROM_EMAIL?.trim()
  const invalidFrom = Boolean(from && !usesVerifiedStocMedDomain(from))

  return {
    ready: missing.length === 0 && !invalidFrom,
    issues: [
      ...missing,
      ...(invalidFrom ? ['RESEND_FROM_EMAIL must use @askstocmed.com'] : []),
    ],
  }
}

export function classifyAdminBroadcastError(error: unknown) {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null
  const code = typeof record?.code === 'string' ? record.code : ''
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : ''

  if (code === '42501' || /authorized administrator|required admin/i.test(message)) {
    return {
      status: 403 as const,
      error: 'Only a provenance-authorized StocMed administrator may send broadcasts',
    }
  }
  if (
    /(?:RESEND_API_KEY|RESEND_FROM_EMAIL|NOTIFICATION_HASH_PEPPER|NOTIFICATION_SIGNING_SECRET).*(?:not configured|must use)/i.test(message)
  ) {
    return {
      status: 503 as const,
      error: 'Email delivery is not configured for production',
    }
  }
  return { status: 500 as const, error: 'The email action failed unexpectedly' }
}
