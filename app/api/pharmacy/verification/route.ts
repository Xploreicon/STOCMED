import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const VERIFICATION_BUCKET = 'pharmacy-verification-documents'
const ALLOWED_FILE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['application/pdf', 'pdf'],
])

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

function hasExpectedFileSignature(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (contentType === 'image/png') {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (contentType === 'application/pdf') {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  }
  return false
}

async function parseVerificationFile(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || value.size <= 0) {
    throw new VerificationUploadError(`${label} is required`, 400)
  }

  const extension = ALLOWED_FILE_TYPES.get(value.type)
  if (!extension) {
    throw new VerificationUploadError(`${label} must be a JPEG, PNG, or PDF`, 415)
  }
  if (value.size > MAX_FILE_BYTES) {
    throw new VerificationUploadError(`${label} must be 5 MB or smaller`, 413)
  }

  const bytes = new Uint8Array(await value.arrayBuffer())
  if (!hasExpectedFileSignature(value.type, bytes)) {
    throw new VerificationUploadError(`${label} contents do not match its file format`, 415)
  }

  return { bytes, contentType: value.type, extension }
}

class VerificationUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'pharmacy-verification-submission', 3, 60 * 60_000)
  if (!rateLimit.success && rateLimit.response) return rateLimit.response

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pharmacy = await ensurePharmacyRecord(supabase, user)
  if (!pharmacy) {
    return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
  }
  if ((pharmacy as any).verification_status === 'full') {
    return NextResponse.json({ error: 'This pharmacy is already fully verified' }, { status: 409 })
  }

  const { data: verificationConfig, error: verificationConfigError } = await (supabase as any)
    .from('pharmacy_verification_config')
    .select('current_standards_version')
    .eq('singleton', true)
    .maybeSingle()
  const standardsVersion = verificationConfig?.current_standards_version?.trim()
  if (verificationConfigError || !standardsVersion) {
    return NextResponse.json({ error: 'Verification standards are unavailable' }, { status: 503 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid verification submission' }, { status: 400 })
  }

  if (formData.get('agree_to_standards') !== 'true') {
    return NextResponse.json({ error: 'You must agree to the current StocMed PCN standards' }, { status: 400 })
  }

  let premisesFile: Awaited<ReturnType<typeof parseVerificationFile>>
  let superintendentFile: Awaited<ReturnType<typeof parseVerificationFile>>
  try {
    ;[premisesFile, superintendentFile] = await Promise.all([
      parseVerificationFile(formData.get('premises_certificate'), 'PCN premises certificate'),
      parseVerificationFile(formData.get('superintendent_annual_licence'), 'Superintendent pharmacist annual licence'),
    ])
  } catch (error) {
    if (error instanceof VerificationUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Could not validate verification documents' }, { status: 400 })
  }

  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Verification service unavailable' }, { status: 503 })
  }

  const premisesPath = `${pharmacy.id}/premises-${randomUUID()}.${premisesFile.extension}`
  const superintendentPath = `${pharmacy.id}/superintendent-${randomUUID()}.${superintendentFile.extension}`
  const plannedPaths = [premisesPath, superintendentPath]
  const uploadedPaths: string[] = []

  const { error: stagingError } = await (admin as any)
    .from('pharmacy_verification_upload_staging')
    .insert(plannedPaths.map((objectPath) => ({
      object_path: objectPath,
      pharmacy_id: pharmacy.id,
      uploaded_by: user.id,
    })))
  if (stagingError) {
    return NextResponse.json({ error: 'Could not prepare private verification storage' }, { status: 503 })
  }

  const clearStaging = async () => {
    const { error } = await (admin as any)
      .from('pharmacy_verification_upload_staging')
      .delete()
      .in('object_path', plannedPaths)
    if (error) console.error('Could not clear verification upload staging rows:', error)
  }

  const { error: premisesUploadError } = await admin.storage
    .from(VERIFICATION_BUCKET)
    .upload(premisesPath, premisesFile.bytes, {
      contentType: premisesFile.contentType,
      cacheControl: '0',
      upsert: false,
    })
  if (premisesUploadError) {
    const { error: cleanupError } = await admin.storage
      .from(VERIFICATION_BUCKET)
      .remove([premisesPath])
    if (!cleanupError) await clearStaging()
    return NextResponse.json({ error: 'Could not securely store the PCN premises certificate' }, { status: 500 })
  }
  uploadedPaths.push(premisesPath)

  const { error: superintendentUploadError } = await admin.storage
    .from(VERIFICATION_BUCKET)
    .upload(superintendentPath, superintendentFile.bytes, {
      contentType: superintendentFile.contentType,
      cacheControl: '0',
      upsert: false,
    })
  if (superintendentUploadError) {
    const { error: cleanupError } = await admin.storage.from(VERIFICATION_BUCKET).remove(uploadedPaths)
    if (!cleanupError) await clearStaging()
    return NextResponse.json({ error: 'Could not securely store the superintendent pharmacist licence' }, { status: 500 })
  }
  uploadedPaths.push(superintendentPath)

  const documentReference = JSON.stringify({
    premises_certificate: premisesPath,
    superintendent_annual_licence: superintendentPath,
  })
  const { data, error } = await (supabase.rpc as any)('submit_pharmacy_verification_requirements_client', {
    p_document_reference: documentReference,
    p_standards_version: standardsVersion,
    p_agree_to_standards: true,
  })

  if (error) {
    const { error: cleanupError } = await admin.storage
      .from(VERIFICATION_BUCKET)
      .remove(uploadedPaths)
    if (cleanupError) {
      console.error('Verification submission failed and document cleanup was deferred:', cleanupError)
    } else {
      await clearStaging()
    }
    return NextResponse.json({ error: error.message || 'Could not submit verification requirements' }, { status: 409 })
  }

  const updatedPharmacy = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ pharmacy: updatedPharmacy, standards_version: standardsVersion }, {
    status: 201,
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
