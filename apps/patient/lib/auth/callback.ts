import { createCallbackDeduplicator, parseAuthCallback, safePatientDestination, type IntentResult } from './native-oauth'

type Exchange = { error: unknown; data: { session: unknown; redirectType?: string | null } }
type CallbackDependencies = {
  webOrigin: string; readIntent: () => IntentResult; clearIntent: () => void
  exchange: (code: string) => Promise<Exchange>; closeBrowser: () => Promise<void>
  complete: (next: string) => Promise<string>; refreshProfile: () => Promise<void>
  setRecovery: () => void; navigate: (next: string) => void; reportError: (message: string) => void
  discardSession?: () => Promise<void>
}

export function createAuthCallbackHandler(deps: CallbackDependencies) {
  const acceptCode = createCallbackDeduplicator()
  let processing = false
  return async (rawUrl: string) => {
    const callback = parseAuthCallback(rawUrl, deps.webOrigin)
    if (!callback || processing) return 'ignored' as const
    if (callback.kind === 'code' && !acceptCode(callback.code)) return 'ignored' as const
    let pending: IntentResult
    try { pending = deps.readIntent() } catch { deps.reportError('Session storage is unavailable. Please reopen the app.'); return 'error' as const }
    if (pending.status !== 'valid') {
      deps.clearIntent()
      deps.reportError(pending.status === 'expired' ? 'This sign-in request expired. Please start again.'
        : 'Start sign-in or password recovery on this device before opening its link.')
      return 'error' as const
    }
    if (callback.intent && callback.intent !== pending.intent.kind) {
      deps.clearIntent(); deps.reportError('This link does not match the sign-in request. Please start again.'); return 'error' as const
    }
    if (callback.kind === 'error') { deps.clearIntent(); deps.reportError(callback.error); return 'error' as const }
    processing = true
    deps.clearIntent()
    let exchanged = false
    try {
      try { await deps.closeBrowser() } catch { /* Native browser may already be closed. */ }
      const result = await deps.exchange(callback.code)
      if (result.error || !result.data.session) throw new Error('This sign-in link could not be verified. Please start again.')
      exchanged = true
      if (pending.intent.kind === 'recovery') {
        if (result.data.redirectType !== 'recovery') throw new Error('Open a new password recovery link before setting a password.')
        deps.setRecovery(); await deps.refreshProfile(); deps.navigate('/update-password')
      } else {
        if (result.data.redirectType === 'recovery') throw new Error('Start password recovery on this device and use its new link.')
        const next = await deps.complete(pending.intent.next)
        await deps.refreshProfile(); deps.navigate(safePatientDestination(next, '/'))
      }
      return 'completed' as const
    } catch (cause) {
      if (exchanged) { try { await deps.discardSession?.() } catch { /* Still report the failed authoritative completion. */ } }
      deps.reportError(cause instanceof Error ? cause.message : 'Sign-in could not be completed. Please start again.')
      return 'error' as const
    } finally { processing = false }
  }
}
