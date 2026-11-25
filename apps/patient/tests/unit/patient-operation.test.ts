import { describe, expect, it, vi } from 'vitest'
import { abortPatientOperationScope, createPatientOperationScope, createPatientOwnerAssertion, patientOperationInit } from '@/lib/patient-operation'

describe('patient operation ownership and lifetime', () => {
  it('binds the mounted account and keeps its signal connected after response headers', () => {
    const scope = createPatientOperationScope('patient-a')
    const init = patientOperationInit(scope, 'patient-a', { method: 'POST', expectedUserId: 'overridden' })
    expect(init.expectedUserId).toBe('patient-a')
    expect(init.signal?.aborted).toBe(false)
    abortPatientOperationScope(scope)
    expect(init.signal?.aborted).toBe(true)
    expect(() => patientOperationInit(scope, 'patient-a')).toThrow(expect.objectContaining({ name: 'AbortError' }))
  })
  it('rejects stale callbacks after owner replacement, and permits a fresh mount', () => {
    const next = createPatientOperationScope('patient-b')
    expect(() => patientOperationInit(next, 'patient-a')).toThrow(expect.objectContaining({ name: 'AbortError' }))
    expect(patientOperationInit(next, 'patient-b').expectedUserId).toBe('patient-b')
  })
  it('links optional caller cancellation without aborting other owner requests', () => {
    const scope = createPatientOperationScope('patient-a')
    const caller = new AbortController()
    const linked = patientOperationInit(scope, 'patient-a', { signal: caller.signal })
    const sibling = patientOperationInit(scope, 'patient-a')
    caller.abort()
    expect(linked.signal?.aborted).toBe(true)
    expect(sibling.signal?.aborted).toBe(false)
    const laterCaller = new AbortController()
    const later = patientOperationInit(scope, 'patient-a', { signal: laterCaller.signal })
    abortPatientOperationScope(scope)
    expect(later.signal?.aborted).toBe(true)
  })
  it('rejects requests before mount, without an owner, or with an already canceled caller', () => {
    expect(() => patientOperationInit(null, 'patient-a')).toThrow(expect.objectContaining({ name: 'AbortError' }))
    expect(() => patientOperationInit(createPatientOperationScope(null), null)).toThrow(expect.objectContaining({ name: 'AbortError' }))
    const caller = new AbortController(); caller.abort()
    expect(() => patientOperationInit(createPatientOperationScope('patient-a'), 'patient-a', { signal: caller.signal }))
      .toThrow(expect.objectContaining({ name: 'AbortError' }))
  })

  it('refuses an old A form callback when the awaited SDK session becomes B', async () => {
    const scope = createPatientOperationScope('patient-a')
    let resolveSession!: (id: string) => void
    const pendingSession = new Promise<string>(resolve => { resolveSession = resolve })
    const assertOwner = createPatientOwnerAssertion(() => scope, 'patient-a', () => pendingSession)
    const writeForm = vi.fn()
    const oldFormCallback = async () => {
      const formOwner = await assertOwner()
      writeForm({ user_id: formOwner, full_name: 'A old form', consented: true })
    }
    const save = oldFormCallback()
    resolveSession('patient-b')
    await expect(save).rejects.toMatchObject({ name: 'AbortError' })
    expect(writeForm).not.toHaveBeenCalled()
  })

  it('refuses a fresh B getUser response and an unmounted form after its await', async () => {
    const scope = createPatientOperationScope('patient-a')
    const assertOwner = createPatientOwnerAssertion(() => scope, 'patient-a', async () => 'patient-a')
    await expect(assertOwner('patient-b')).rejects.toMatchObject({ name: 'AbortError' })
    const pending = assertOwner()
    abortPatientOperationScope(scope)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
