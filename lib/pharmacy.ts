import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { isPcnNumberFormatValid, normalizePcnNumber } from '@/lib/validation/pcn'

type PharmacyRow = Database['public']['Tables']['pharmacies']['Row']

export const PHARMACY_PROFILE_SELECT = [
  'id',
  'user_id',
  'pharmacy_name',
  'license_number',
  'address',
  'city',
  'state',
  'latitude',
  'longitude',
  'phone',
  'is_verified',
  'is_active',
  'reservations_enabled',
  'verification_status',
  'pcn_confirmation_status',
  'provisional_started_at',
  'provisional_expires_at',
  'verification_submitted_at',
  'pcn_standards_accepted_at',
  'created_at',
  'updated_at',
  'logo_url',
  'opening_time',
  'closing_time',
].join(',')

type SupabaseServerClient = SupabaseClient<Database, 'public', any>

type PendingPharmacyProfile = {
  pharmacy_name?: string
  license_number?: string
  address?: string
  city?: string
  state?: string
  phone?: string
  logo_url?: string
} | null

type CompletedPharmacyProfile = {
  pharmacy_name: string
  license_number: string
  address: string
  city: string
  state: string
  phone: string
  logo_url?: string
}

function hasCompletePendingProfile(
  profile: PendingPharmacyProfile
): profile is CompletedPharmacyProfile {
  if (!profile) return false
  const requiredFields: Array<keyof NonNullable<PendingPharmacyProfile>> = [
    'pharmacy_name',
    'license_number',
    'address',
    'city',
    'state',
    'phone',
  ]
  return requiredFields.every(
    (field) => profile[field] && profile[field]?.toString().trim().length
  )
}

export async function ensurePharmacyRecord(
  supabase: SupabaseServerClient,
  user: User
): Promise<PharmacyRow | null> {
  const metadata = user.user_metadata ?? {}

  // Resolve the owner row inside PostgreSQL. This avoids making every
  // authenticated pharmacy route depend on broad direct table grants while
  // keeping tenant resolution authoritative through auth.uid().
  const { data: existingPharmacy, error: lookupError } = await (supabase.rpc as any)(
    'get_authenticated_pharmacy_profile'
  )

  if (lookupError) {
    console.error('Error fetching pharmacy for user:', lookupError)
    throw lookupError
  }

  if (existingPharmacy) {
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          pharmacy_id: existingPharmacy.id,
          pharmacy_profile: null,
        },
      })
      if (updateError) {
        console.warn('Non-fatal: Failed to update user metadata with pharmacy_id:', updateError.message)
      }
    } catch (err) {
      console.warn('Non-fatal: Exception updating user metadata with pharmacy_id:', err)
    }
    return existingPharmacy as PharmacyRow
  }

  const pendingProfile = metadata.pharmacy_profile as PendingPharmacyProfile

  if (!hasCompletePendingProfile(pendingProfile)) {
    return null
  }

  if (!isPcnNumberFormatValid(pendingProfile.license_number)) {
    throw new Error('The saved PCN premises number has an invalid format')
  }

  const { data: registrationResult, error: insertError } = await (supabase.rpc as any)(
    'register_provisional_pharmacy_client',
    {
      p_pharmacy_name: pendingProfile.pharmacy_name.trim(),
      p_license_number: normalizePcnNumber(pendingProfile.license_number),
      p_address: pendingProfile.address.trim(),
      p_city: pendingProfile.city.trim(),
      p_state: pendingProfile.state.trim(),
      p_phone: pendingProfile.phone.trim(),
    }
  )
  const insertedPharmacy = Array.isArray(registrationResult)
    ? registrationResult[0]
    : registrationResult

  if (insertError || !insertedPharmacy) {
    console.error('Error auto-creating pharmacy during login:', insertError)
    throw insertError
  }

  try {
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        pharmacy_id: insertedPharmacy.id,
        pharmacy_profile: null,
      },
    })
    if (updateError) {
      console.warn('Non-fatal: Failed to update user metadata with inserted pharmacy_id:', updateError.message)
    }
  } catch (err) {
    console.warn('Non-fatal: Exception updating user metadata after insert:', err)
  }

  return insertedPharmacy as PharmacyRow
}
