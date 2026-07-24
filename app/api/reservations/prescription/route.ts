import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { POM_MOLECULES_LIST } from '@/lib/triage/keyword-lists'

export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 5 * 1024 * 1024
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
  if (contentType === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (contentType === 'application/pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  return false
}

function isKnownPomProduct(product: {
  generic_name?: string | null
  brand_name?: string | null
  requires_prescription?: boolean
} | null) {
  if (product?.requires_prescription) return true
  const name = `${product?.generic_name ?? ''} ${product?.brand_name ?? ''}`.toLowerCase()
  return POM_MOLECULES_LIST.terms.some((term) => name.includes(term.toLowerCase()))
}

const requestSchema = z.object({
  inventory_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(10),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view prescription requests' }, { status: 401 })

  const { data, error } = await (supabase as any)
    .from('rx_submissions')
    .select(`
      id, product_name, requested_quantity, status, review_notes, created_at, reviewed_at,
      destination_pharmacy_id, reservation_id,
      pharmacies!rx_submissions_destination_pharmacy_id_fkey(pharmacy_name,address,phone),
      reservations(id,pickup_code,status,expires_at)
    `)
    .eq('flow_model', 'destination_model_a')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'prescription-reservation', 5, 60_000)
  if (!rateLimit.success && rateLimit.response) return rateLimit.response

  const globallyEnabled = process.env.STAFFED_SAFETY_FLOWS_ENABLED === 'true'
    && process.env.RX_RESERVATIONS_ENABLED === 'true'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in before uploading a prescription' }, { status: 401 })

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Prescription service is unavailable' }, { status: 503 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid prescription upload' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse({
    inventory_id: formData.get('inventory_id'),
    quantity: formData.get('quantity'),
  })
  const file = formData.get('file')
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json({ error: 'Medication, exact quantity, and prescription file are required' }, { status: 400 })
  }

  const extension = ALLOWED_FILE_TYPES.get(file.type)
  if (!extension) return NextResponse.json({ error: 'Upload a JPEG, PNG, or PDF prescription' }, { status: 415 })
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Prescription files must be no larger than 5 MB' }, { status: 413 })
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  if (!hasExpectedFileSignature(file.type, fileBytes)) {
    return NextResponse.json({ error: 'The file contents do not match the selected JPEG, PNG, or PDF format' }, { status: 415 })
  }

  const { data: retention } = await (admin as any)
    .from('rx_retention_policy')
    .select('retention_days,is_confirmed')
    .eq('singleton', true)
    .maybeSingle()
  const { data: inventory, error: inventoryError } = await (admin as any)
    .from('pharmacy_inventory')
    .select(`
      id,pharmacy_id,is_listed,deleted_at,
      products!inner(generic_name,brand_name,requires_prescription,is_verified)
    `)
    .eq('id', parsed.data.inventory_id)
    .eq('item_type', 'medicine')
    .maybeSingle()
  if (inventoryError || !inventory || !inventory.is_listed || inventory.deleted_at) {
    return NextResponse.json({ error: 'Medication is not available for prescription reservation' }, { status: 404 })
  }
  if (!inventory.products?.is_verified) {
    return NextResponse.json({ error: 'Medication is not verified for digital prescription reservation' }, { status: 409 })
  }
  if (!isKnownPomProduct(inventory.products)) {
    return NextResponse.json({ error: 'Use the standard hold action for this medication' }, { status: 409 })
  }

  const [{ data: pharmacy }, { data: availability }] = await Promise.all([
    (admin as any)
      .from('pharmacies')
      .select(`
        id,user_id,reservations_enabled,is_active,is_verified,is_test_account,
        verification_status,
        verification_authorized_at,verification_authorization_basis
      `)
      .eq('id', inventory.pharmacy_id)
      .maybeSingle(),
    (admin.rpc as any)('reservation_sellable_quantities', { p_inventory_ids: [inventory.id] }),
  ])
  const { data: superintendent } = pharmacy?.user_id
    ? await (admin as any)
      .from('users')
      .select(`
        is_licensed_pharmacist,
        pharmacist_license_verified_at,pharmacist_license_verification_basis
      `)
      .eq('user_id', pharmacy.user_id)
      .maybeSingle()
    : { data: null }
  const { data: centralReviewerRows } = await (admin as any)
    .from('users')
    .select(`
      is_stocmed_sp,stocmed_sp_authorized_at,stocmed_sp_authorization_basis,
      is_licensed_pharmacist,pharmacist_license_verified_at,pharmacist_license_verification_basis
    `)
    .eq('is_stocmed_sp', true)
    .eq('is_licensed_pharmacist', true)
    .limit(1)
  const centralReviewer = Array.isArray(centralReviewerRows) ? centralReviewerRows[0] : null
  const digitalRxEnabled = globallyEnabled || pharmacy?.is_test_account === true
  if (!digitalRxEnabled) {
    return NextResponse.json({
      error: 'Digital prescription reservations are not currently staffed',
    }, { status: 503 })
  }
  if (!pharmacy?.is_test_account && (!retention?.is_confirmed || !retention?.retention_days)) {
    return NextResponse.json({
      error: 'Digital prescription reservations are paused until the approved retention period is configured. Please call the pharmacy.',
    }, { status: 503 })
  }
  const pharmacyHasTrustedVerification = Boolean(
    pharmacy?.verification_status === 'full'
    && pharmacy?.is_verified
    && pharmacy.verification_authorized_at
    && pharmacy.verification_authorization_basis?.trim(),
  )
  const superintendentHasTrustedLicence = Boolean(
    superintendent?.is_licensed_pharmacist
    && superintendent.pharmacist_license_verified_at
    && superintendent.pharmacist_license_verification_basis?.trim(),
  )
  const centralReviewerHasTrustedLicence = Boolean(
    centralReviewer?.is_stocmed_sp
    && centralReviewer.stocmed_sp_authorized_at
    && centralReviewer.stocmed_sp_authorization_basis?.trim()
    && centralReviewer.is_licensed_pharmacist
    && centralReviewer.pharmacist_license_verified_at
    && centralReviewer.pharmacist_license_verification_basis?.trim()
  )
  if (!pharmacy?.reservations_enabled || !pharmacy?.is_active
      || !pharmacyHasTrustedVerification
      || (!superintendentHasTrustedLicence && !centralReviewerHasTrustedLicence)) {
    return NextResponse.json({ error: 'This pharmacy is not accepting digital prescription reservations' }, { status: 409 })
  }
  const currentAvailability = Array.isArray(availability) ? availability[0] : availability
  if (Number(currentAvailability?.sellable_quantity ?? 0) < parsed.data.quantity) {
    return NextResponse.json({ error: 'The requested quantity is no longer available' }, { status: 409 })
  }

  const objectPath = `${user.id}/${randomUUID()}.${extension}`
  const { error: stagingError } = await (admin as any)
    .from('rx_upload_staging')
    .insert({ object_path: objectPath, user_id: user.id })
  if (stagingError) {
    return NextResponse.json({ error: 'Could not prepare secure prescription storage' }, { status: 503 })
  }

  const { error: uploadError } = await admin.storage
    .from('prescriptions')
    .upload(objectPath, fileBytes, { contentType: file.type, cacheControl: '0', upsert: false })
  if (uploadError) {
    return NextResponse.json({ error: 'Could not securely store the prescription' }, { status: 500 })
  }

  const { data: submission, error: submissionError } = await (admin as any)
    .from('rx_submissions')
    .insert({
      user_id: user.id,
      product_name: 'Pending validation',
      file_url: objectPath,
      flow_model: 'destination_model_a',
      destination_pharmacy_id: inventory.pharmacy_id,
      inventory_id: inventory.id,
      requested_quantity: parsed.data.quantity,
      status: 'submitted',
    })
    .select('id,product_name,requested_quantity,status,created_at,destination_pharmacy_id')
    .single()

  if (submissionError || !submission) {
    const { error: cleanupError } = await admin.storage.from('prescriptions').remove([objectPath])
    if (!cleanupError) {
      const { error: stagingCleanupError } = await (admin as any)
        .from('rx_upload_staging')
        .delete()
        .eq('object_path', objectPath)
      if (stagingCleanupError) {
        console.error('Could not clear cleaned prescription upload staging record:', stagingCleanupError)
      }
    } else {
      console.error('Prescription upload cleanup deferred to staging purge:', cleanupError)
    }
    const message = /retention policy/i.test(submissionError?.message ?? '')
      ? 'Digital prescription reservations are paused until retention is configured.'
      : submissionError?.message ?? 'Could not submit the prescription'
    return NextResponse.json({ error: message }, { status: 409 })
  }

  const { error: stagingDeleteError } = await (admin as any)
    .from('rx_upload_staging')
    .delete()
    .eq('object_path', objectPath)
  if (stagingDeleteError) {
    console.error('Prescription submitted but upload staging cleanup was deferred:', stagingDeleteError)
  }

  return NextResponse.json({ submission }, {
    status: 201,
    headers: { 'Cache-Control': 'no-store' },
  })
}
