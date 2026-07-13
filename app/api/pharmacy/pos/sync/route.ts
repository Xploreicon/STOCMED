import { NextRequest, NextResponse } from 'next/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { createClient } from '@/lib/supabase/server'
import { posSyncSchema } from '@/lib/validation/pos'

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

function shiftRpc(
  client: Awaited<ReturnType<typeof createClient>>,
  name: string,
  args: Record<string, unknown>
) {
  const call = client.rpc as unknown as (fn: string, parameters: Record<string, unknown>) => RpcResult
  return call(name, args)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pharmacy = await ensurePharmacyRecord(supabase, user)
    if (!pharmacy) return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })

    const parsed = posSyncSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid sync payload', details: parsed.error.flatten() }, { status: 400 })
    }

    const syncedIds: string[] = []
    const syncedShiftIds: string[] = []
    const failedIds: Array<{ id: string; error: string }> = []
    const failedShiftIds: Array<{ id: string; error: string }> = []
    const failedShiftSet = new Set<string>()

    // Closed offline shifts must first exist as open records so queued sales can attach.
    for (const shift of parsed.data.shifts) {
      const { error } = await shiftRpc(supabase, 'sync_shift_open', {
        p_shift_id: shift.id,
        p_pharmacy_id: pharmacy.id,
        p_opening_float: shift.opening_float,
        p_opened_at: shift.opened_at,
      })
      if (error) {
        failedShiftSet.add(shift.id)
        failedShiftIds.push({ id: shift.id, error: error.message || 'Shift open sync failed' })
      }
    }

    for (const sale of parsed.data.sales) {
      if (failedShiftSet.has(sale.shift_id)) {
        failedIds.push({ id: sale.id, error: 'The sale shift has not synced yet' })
        continue
      }
      const { error } = await shiftRpc(supabase, 'sync_pos_sale_with_shift', {
        p_pharmacy_id: pharmacy.id,
        p_sale: sale,
      })
      if (error) failedIds.push({ id: sale.id, error: error.message || 'Sale sync failed' })
      else syncedIds.push(sale.id)
    }

    for (const shift of parsed.data.shifts.filter((item) => item.status === 'closed')) {
      if (failedShiftSet.has(shift.id)) continue
      if (shift.counted_cash == null || !shift.closed_at) {
        failedShiftSet.add(shift.id)
        failedShiftIds.push({ id: shift.id, error: 'Closed shifts require counted cash and a close time' })
        continue
      }
      const { error } = await shiftRpc(supabase, 'sync_shift_close', {
        p_shift_id: shift.id,
        p_pharmacy_id: pharmacy.id,
        p_counted_cash: shift.counted_cash,
        p_notes: shift.notes ?? null,
        p_closed_at: shift.closed_at,
      })
      if (error) {
        failedShiftSet.add(shift.id)
        failedShiftIds.push({ id: shift.id, error: error.message || 'Shift close sync failed' })
      } else {
        syncedShiftIds.push(shift.id)
      }
    }

    for (const shift of parsed.data.shifts.filter((item) => item.status === 'open')) {
      if (!failedShiftSet.has(shift.id)) syncedShiftIds.push(shift.id)
    }

    return NextResponse.json({ success: true, syncedIds, syncedShiftIds, failedIds, failedShiftIds })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error during POS sync' },
      { status: 500 }
    )
  }
}
