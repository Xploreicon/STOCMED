import { NextRequest, NextResponse } from 'next/server'

import {
  IMPORT_STRUCTURER_BATCH_SIZE,
  structureImportRows,
  type ImportStructureInput,
} from '@/lib/import-ai-structurer'
import { logger } from '@/lib/observability'
import { getAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BATCHES_PER_INVOCATION = 4

type ClaimedRow = {
  claim_token: string
  staging_id: string
  job_id: string
  pharmacy_id: string
  source_row_number: number
  raw_name: string
  source_fields: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient() as any
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  let batches = 0
  let rowsProcessed = 0
  let inputTokens = 0
  let outputTokens = 0
  let failedBatches = 0

  for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_INVOCATION; batchIndex += 1) {
    const { data: claimData, error: claimError } = await admin.rpc('claim_import_ai_batch', {
      p_limit: IMPORT_STRUCTURER_BATCH_SIZE,
    })
    if (claimError) {
      logger.error('import_structurer_claim_failed', claimError, { batch_index: batchIndex })
      return NextResponse.json({ error: 'Could not claim import structuring work' }, { status: 500 })
    }

    const claimed = (claimData || []) as ClaimedRow[]
    if (claimed.length === 0) break
    const claimToken = claimed[0].claim_token

    try {
      const structured = await structureImportRows(claimed.map((row): ImportStructureInput => ({
        id: row.staging_id,
        source_row_number: row.source_row_number,
        raw_name: row.raw_name,
        source_fields: row.source_fields || {},
      })))

      const { error: completionError } = await admin.rpc('complete_import_ai_batch', {
        p_claim_token: claimToken,
        p_results: structured.rows,
        p_model: structured.model,
        p_input_tokens: structured.inputTokens,
        p_output_tokens: structured.outputTokens,
      })
      if (completionError) throw completionError

      batches += 1
      rowsProcessed += claimed.length
      inputTokens += structured.inputTokens
      outputTokens += structured.outputTokens
    } catch (error) {
      failedBatches += 1
      logger.error('import_structurer_batch_failed', error, {
        batch_rows: claimed.length,
        job_id: claimed[0].job_id,
      })
      await admin.rpc('fail_import_ai_batch', {
        p_claim_token: claimToken,
        p_error: error instanceof Error ? error.message : 'Import structuring failed',
      })
    }
  }

  return NextResponse.json({
    batches,
    rows_processed: rowsProcessed,
    failed_batches: failedBatches,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    batch_size: IMPORT_STRUCTURER_BATCH_SIZE,
  })
}
