import type { NativeRequestInit } from '@/lib/api/client'

export type PatientOperationScope = { ownerId: string | null; alive: boolean; controller: AbortController }

export function createPatientOperationScope(ownerId: string | null): PatientOperationScope {
  return { ownerId, alive: true, controller: new AbortController() }
}

export function abortPatientOperationScope(scope: PatientOperationScope) {
  scope.alive = false
  scope.controller.abort()
}

export function isPatientAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function aborted(): never { throw new DOMException('This patient operation is no longer active.', 'AbortError') }

// Retain the owner linkage after response headers: an SSE body can still be read.
// The listeners are removed when either signal aborts, including owner unmount.
function linkedSignal(owner: AbortSignal, caller?: AbortSignal | null): AbortSignal {
  if (!caller || caller === owner) return owner
  if (owner.aborted || caller.aborted) aborted()
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
    owner.removeEventListener('abort', abort)
    caller.removeEventListener('abort', abort)
  }
  owner.addEventListener('abort', abort, { once: true })
  caller.addEventListener('abort', abort, { once: true })
  return controller.signal
}

export function patientOperationInit(scope: PatientOperationScope | null, capturedOwnerId: string | null,
  init: NativeRequestInit = {}): NativeRequestInit {
  if (!scope?.alive || !capturedOwnerId || scope.ownerId !== capturedOwnerId || scope.controller.signal.aborted || init.signal?.aborted) aborted()
  return { ...init, expectedUserId: capturedOwnerId, signal: linkedSignal(scope.controller.signal, init.signal) }
}

/** Checks an async form's captured identity before and after reading the SDK session. */
export function createPatientOwnerAssertion(getScope: () => PatientOperationScope | null,
  capturedOwnerId: string | null, getCurrentOwner: () => Promise<string | null>) {
  return async (verifiedOwnerId?: string | null): Promise<string> => {
    patientOperationInit(getScope(), capturedOwnerId)
    let currentOwnerId: string | null
    try { currentOwnerId = await getCurrentOwner() }
    catch (error) {
      patientOperationInit(getScope(), capturedOwnerId)
      throw error
    }
    patientOperationInit(getScope(), capturedOwnerId)
    if (currentOwnerId !== capturedOwnerId || (verifiedOwnerId !== undefined && verifiedOwnerId !== capturedOwnerId)) aborted()
    return capturedOwnerId!
  }
}
