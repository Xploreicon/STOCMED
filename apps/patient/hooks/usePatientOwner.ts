'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase/client'
import { abortPatientOperationScope, createPatientOperationScope, createPatientOwnerAssertion,
  type PatientOperationScope } from '@/lib/patient-operation'

/** Direct Supabase form operations must keep the account that opened the form. */
export function usePatientOwner() {
  const { user } = useAuth()
  const ownerId = user?.id || null
  const lifetime = useRef<PatientOperationScope | null>(null)
  useEffect(() => {
    const scope = createPatientOperationScope(ownerId)
    lifetime.current = scope
    return () => abortPatientOperationScope(scope)
  }, [ownerId])
  const assertOwner = useMemo(() => createPatientOwnerAssertion(() => lifetime.current, ownerId, async () => {
    const { data: { session }, error } = await createClient().auth.getSession()
    if (error) throw error
    return session?.user.id || null
  }), [ownerId])
  return { ownerId, assertOwner }
}
