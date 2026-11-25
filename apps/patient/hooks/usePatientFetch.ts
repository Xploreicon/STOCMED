'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { nativeFetch, type NativeRequestInit } from '@/lib/api/client'
import { abortPatientOperationScope, createPatientOperationScope, patientOperationInit,
  type PatientOperationScope } from '@/lib/patient-operation'

/** Every request in a protected page belongs to its mounted patient account. */
export function usePatientFetch() {
  const { user } = useAuth()
  const ownerId = user?.id || null
  const lifetime = useRef<PatientOperationScope | null>(null)
  useEffect(() => {
    // A fresh controller is required when React repeats effect setup in Strict Mode.
    const scope = createPatientOperationScope(ownerId)
    lifetime.current = scope
    return () => { abortPatientOperationScope(scope) }
  }, [ownerId])
  return useCallback((path: string, init: NativeRequestInit = {}) => {
    try { return nativeFetch(path, patientOperationInit(lifetime.current, ownerId, init)) }
    catch (error) { return Promise.reject(error) }
  }, [ownerId])
}
