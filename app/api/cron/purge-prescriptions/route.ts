import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const { data: expiredProvisionalPharmacies, error: provisionalExpiryError } = await (admin.rpc as any)(
    'expire_provisional_pharmacies'
  )
  if (provisionalExpiryError) {
    return NextResponse.json({ error: provisionalExpiryError.message }, { status: 500 })
  }

  let queuedFilesPurged = 0
  const queueFailures: string[] = []
  const { data: queuedFiles, error: queueError } = await (admin as any)
    .from('private_file_deletion_queue')
    .select('id,bucket,object_path,attempts')
    .is('completed_at', null)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (queueError) return NextResponse.json({ error: queueError.message }, { status: 500 })

  for (const file of queuedFiles ?? []) {
    const { error: storageError } = await admin.storage.from(file.bucket).remove([file.object_path])
    if (storageError) {
      queueFailures.push(file.id)
      await (admin as any)
        .from('private_file_deletion_queue')
        .update({ attempts: Number(file.attempts ?? 0) + 1, last_error: storageError.message })
        .eq('id', file.id)
      continue
    }

    const { error: deleteQueueError } = await (admin as any)
      .from('private_file_deletion_queue')
      .delete()
      .eq('id', file.id)
    if (deleteQueueError) {
      queueFailures.push(file.id)
      continue
    }
    queuedFilesPurged += 1
  }

  let orphanUploadsPurged = 0
  const orphanFailures: string[] = []
  const { data: orphanUploads, error: orphanError } = await (admin as any)
    .from('rx_upload_staging')
    .select('object_path')
    .lte('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1000)
  if (orphanError) return NextResponse.json({ error: orphanError.message }, { status: 500 })

  for (const upload of orphanUploads ?? []) {
    const pathHash = createHash('sha256').update(upload.object_path).digest('hex')
    const { data: linkedSubmission, error: linkedSubmissionError } = await (admin as any)
      .from('rx_submissions')
      .select('id')
      .eq('file_url', upload.object_path)
      .maybeSingle()
    if (linkedSubmissionError) {
      orphanFailures.push(pathHash)
      continue
    }
    if (linkedSubmission) {
      const { error: stagingDeleteError } = await (admin as any)
        .from('rx_upload_staging')
        .delete()
        .eq('object_path', upload.object_path)
      if (stagingDeleteError) orphanFailures.push(pathHash)
      continue
    }

    const { error: storageError } = await admin.storage.from('prescriptions').remove([upload.object_path])
    if (storageError) {
      orphanFailures.push(pathHash)
      await (admin as any).from('rx_purge_events').insert({
        object_path_hash: pathHash,
        outcome: 'orphan_storage_delete_failed',
      })
      continue
    }

    const { error: stagingDeleteError } = await (admin as any)
      .from('rx_upload_staging')
      .delete()
      .eq('object_path', upload.object_path)
    if (stagingDeleteError) {
      orphanFailures.push(pathHash)
      continue
    }
    orphanUploadsPurged += 1
    await (admin as any).from('rx_purge_events').insert({
      object_path_hash: pathHash,
      outcome: 'orphan_upload_purged',
    })
  }

  let verificationUploadsPurged = 0
  const verificationUploadFailures: string[] = []
  const verificationCutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  const { data: verificationUploads, error: verificationUploadError } = await (admin as any)
    .from('pharmacy_verification_upload_staging')
    .select('object_path')
    .lte('created_at', verificationCutoff)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (verificationUploadError) {
    return NextResponse.json({ error: verificationUploadError.message }, { status: 500 })
  }

  for (const upload of verificationUploads ?? []) {
    const pathHash = createHash('sha256').update(upload.object_path).digest('hex')
    const { data: linkedSubmission, error: linkedError } = await (admin as any)
      .from('pharmacy_verification_submissions')
      .select('id')
      .or(`premises_certificate_path.eq.${upload.object_path},superintendent_annual_licence_path.eq.${upload.object_path}`)
      .limit(1)
      .maybeSingle()
    if (linkedError) {
      verificationUploadFailures.push(pathHash)
      continue
    }

    if (!linkedSubmission) {
      const { error: storageError } = await admin.storage
        .from('pharmacy-verification-documents')
        .remove([upload.object_path])
      if (storageError) {
        verificationUploadFailures.push(pathHash)
        continue
      }
    }

    const { error: stagingDeleteError } = await (admin as any)
      .from('pharmacy_verification_upload_staging')
      .delete()
      .eq('object_path', upload.object_path)
    if (stagingDeleteError) {
      verificationUploadFailures.push(pathHash)
      continue
    }
    verificationUploadsPurged += 1
  }

  const { data: expired, error } = await (admin as any)
    .from('rx_submissions')
    .select('id,file_url,reservation_id')
    .not('purge_after', 'is', null)
    .lte('purge_after', new Date().toISOString())
    .order('purge_after', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let purged = 0
  const failures: string[] = []
  for (const submission of expired ?? []) {
    const pathHash = createHash('sha256').update(submission.file_url).digest('hex')

    if (submission.reservation_id) {
      const { error: cancelError } = await (admin as any)
        .from('reservations')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Prescription retention period ended',
        })
        .eq('id', submission.reservation_id)
        .eq('status', 'active')
      if (cancelError) {
        failures.push(submission.id)
        await (admin as any).from('rx_purge_events').insert({
          object_path_hash: pathHash,
          outcome: 'reservation_cancel_failed',
        })
        continue
      }
    }

    const { error: storageError } = await admin.storage.from('prescriptions').remove([submission.file_url])
    if (storageError) {
      failures.push(submission.id)
      await (admin as any).from('rx_purge_events').insert({ object_path_hash: pathHash, outcome: 'storage_delete_failed' })
      continue
    }

    const { error: deleteError } = await (admin as any).from('rx_submissions').delete().eq('id', submission.id)
    if (deleteError) {
      failures.push(submission.id)
      await (admin as any).from('rx_purge_events').insert({ object_path_hash: pathHash, outcome: 'database_delete_failed' })
      continue
    }

    purged += 1
    await (admin as any).from('rx_purge_events').insert({ object_path_hash: pathHash, outcome: 'purged' })
  }

  return NextResponse.json({
    scanned: expired?.length ?? 0,
    purged,
    failures,
    queued_files_purged: queuedFilesPurged,
    queue_failures: queueFailures,
    orphan_uploads_purged: orphanUploadsPurged,
    orphan_failures: orphanFailures.length,
    provisional_pharmacies_expired: Number(expiredProvisionalPharmacies ?? 0),
    verification_uploads_purged: verificationUploadsPurged,
    verification_upload_failures: verificationUploadFailures.length,
  })
}
