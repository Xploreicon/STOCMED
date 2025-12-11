import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type PharmacyRow = Database['public']['Tables']['pharmacies']['Row']

type SupabaseServerClient = SupabaseClient<Database, 'public', any>

type PendingPharmacyProfile = {
  pharmacy_name?: string
  license_number?: string
  address?: string
  city?: string
  state?: string
  phone?: string
} | null

type CompletedPharmacyProfile = {
  pharmacy_name: string
  license_number: string
  address: string
  city: string
  state: string
  phone: string
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
  const metadataPharmacyId = metadata.pharmacy_id as string | undefined

  if (metadataPharmacyId) {
    const { data, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('id', metadataPharmacyId)
      .maybeSingle()

    if (!error && data) {
      return data
    }
  }

  const { data: existingPharmacy, error: lookupError } = await supabase
    .from('pharmacies')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.error('Error fetching pharmacy for user:', lookupError)
    throw lookupError
  }

  if (existingPharmacy) {
    await supabase.auth.updateUser({
      data: {
        pharmacy_id: existingPharmacy.id,
        pharmacy_profile: null,
      },
    })
    return existingPharmacy as PharmacyRow
  }

  const pendingProfile = metadata.pharmacy_profile as PendingPharmacyProfile

  if (!hasCompletePendingProfile(pendingProfile)) {
    return null
  }

  const { data: insertedPharmacy, error: insertError } = await (supabase
    .from('pharmacies') as any)
    .insert({
      user_id: user.id,
      pharmacy_name: pendingProfile.pharmacy_name,
      license_number: pendingProfile.license_number,
      address: pendingProfile.address,
      city: pendingProfile.city,
      state: pendingProfile.state,
      phone: pendingProfile.phone,
    })
    .select('*')
    .single()

  if (insertError || !insertedPharmacy) {
    console.error('Error auto-creating pharmacy during login:', insertError)
    throw insertError
  }

  await supabase.auth.updateUser({
    data: {
      pharmacy_id: insertedPharmacy.id,
      pharmacy_profile: null,
    },
  })

  return insertedPharmacy as PharmacyRow
}
