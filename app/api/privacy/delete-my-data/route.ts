import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function DELETE() {
  const supabase = (await createClient()) as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'Account deletion service is unavailable' }, { status: 503 })

  const { data, error } = await supabase.rpc('delete_my_data')
  if (error) {
    const retainedPrescription = /prescription records are retained/i.test(error.message ?? '')
    return NextResponse.json({
      error: retainedPrescription
        ? 'Prescription records must remain until the approved retention period ends. You can retry after they are purged.'
        : 'Could not delete account data',
    }, { status: retainedPrescription ? 409 : 500 })
  }

  const { data: queuedFiles, error: queueError } = await (admin as any)
    .from('private_file_deletion_queue')
    .select('id,bucket,object_path,attempts')
    .eq('requested_by', user.id)
    .is('completed_at', null)

  if (queueError) {
    return NextResponse.json({
      ...data,
      private_files_removed: 0,
      private_files_queued: true,
    }, { status: 202 })
  }

  let removed = 0
  let queued = 0
  for (const file of queuedFiles ?? []) {
    const { error: storageError } = await admin.storage.from(file.bucket).remove([file.object_path])
    if (storageError) {
      queued += 1
      await (admin as any)
        .from('private_file_deletion_queue')
        .update({ attempts: Number(file.attempts ?? 0) + 1, last_error: storageError.message })
        .eq('id', file.id)
      continue
    }

    removed += 1
    await (admin as any).from('private_file_deletion_queue').delete().eq('id', file.id)
  }

  return NextResponse.json({
    ...data,
    private_files_removed: removed,
    private_files_queued: queued > 0,
  }, { status: queued > 0 ? 202 : 200 })
}
