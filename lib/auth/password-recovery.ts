export const RECOVERY_EMAIL_STORAGE_KEY = 'stocmed:password-recovery-email'

export function buildRecoveryRedirectUrl(origin: string): string {
  return new URL('/auth-callback/recovery', origin).toString()
}

export function normalizeRecoveryCode(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

export function isValidRecoveryCode(value: string): boolean {
  return /^\d{6,8}$/.test(normalizeRecoveryCode(value))
}
