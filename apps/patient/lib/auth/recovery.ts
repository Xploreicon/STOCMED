import { createClient } from '@/lib/supabase/client'
import { clearAuthIntent } from './native-oauth'

let recoverySession = false
export function markRecoverySession(active: boolean) { recoverySession = active }

export async function requestPasswordRecovery(email: string): Promise<{ error: Error | null }> {
  try {
    clearAuthIntent()
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase())
    if (!error) return { error: null }
  } catch { /* Do not expose account or transport details. */ }
  return { error: new Error('We could not send a reset code. Please try again.') }
}

export async function verifyRecoveryCode(email: string, code: string): Promise<{ error: Error | null }> {
  const token = code.replace(/[\s-]/g, '')
  if (!/^\d{6,8}$/.test(token)) return { error: new Error('Enter the 6- to 8-digit code from your email.') }

  markRecoverySession(false)
  try {
    const { data, error } = await createClient().auth.verifyOtp({
      email: email.trim().toLowerCase(), token, type: 'recovery',
    })
    // The SDK emits PASSWORD_RECOVERY for this session. The auth provider
    // uses that event to enable the existing password update screen.
    if (!error && data.session) return { error: null }
  } catch { return { error: new Error('We could not verify your reset code. Please try again.') } }
  return { error: new Error('That reset code is invalid or has expired. Check the code or request a new one.') }
}

export async function updateRecoveryPassword(password: string): Promise<{ error: Error | null }> {
  if (!recoverySession) return { error: new Error('Verify a reset code before setting a password.') }
  try {
    const { error } = await createClient().auth.updateUser({ password })
    if (!error) {
      markRecoverySession(false)
      return { error: null }
    }
  } catch { /* Keep the existing recovery session available for a retry. */ }
  return { error: new Error('Your password could not be updated. Please try again.') }
}
