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
    if (authError || !user) {
      console.error('POS Sync Auth Error:', authError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)
    if (!pharmacy) {
      console.error('POS Sync Error: Pharmacy profile not found for user:', user.id)
      return NextResponse.json({ error: 'Pharmacy profile not found' }, { status: 404 })
    }

    const bodyText = await request.text()
    let rawBody: unknown
    try {
      rawBody = JSON.parse(bodyText)
    } catch (parseError) {
      console.error('POS Sync Error parsing body JSON:', parseError, 'Raw body length:', bodyText?.length)
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const parsed = posSyncSchema.safeParse(rawBody)
    if (!parsed.success) {
      console.error('POS Sync Schema Validation Failed:', parsed.error.flatten(), 'Raw body:', bodyText)
      return NextResponse.json({ error: 'Invalid sync payload', details: parsed.error.flatten() }, { status: 400 })
    }

    const syncedIds: string[] = []
    const syncedShiftIds: string[] = []
    const failedIds: Array<{ id: string; error: string }> = []
    const failedShiftIds: Array<{ id: string; error: string }> = []
    const failedShiftSet = new Set<string>()

    console.log(`Starting POS Sync for pharmacy ${pharmacy.id} (user ${user.id}): shifts=${parsed.data.shifts.length}, sales=${parsed.data.sales.length}`)

    // Closed offline shifts must first exist as open records so queued sales can attach.
    for (const shift of parsed.data.shifts) {
      const { error } = await shiftRpc(supabase, 'sync_shift_open', {
        p_shift_id: shift.id,
        p_pharmacy_id: pharmacy.id,
        p_opening_float: shift.opening_float,
        p_opened_at: shift.opened_at,
      })
      if (error) {
        console.error(`POS Sync Error in sync_shift_open (shift ${shift.id}):`, error)
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
      if (error) {
        console.error(`POS Sync Error in sync_pos_sale_with_shift (sale ${sale.id}):`, error)
        failedIds.push({ id: sale.id, error: error.message || 'Sale sync failed' })
      } else {
        syncedIds.push(sale.id)
      }
    }

    for (const shift of parsed.data.shifts.filter((item) => item.status === 'closed')) {
      if (failedShiftSet.has(shift.id)) continue
      if (shift.counted_cash == null || !shift.closed_at) {
        failedShiftSet.add(shift.id)
        console.error(`POS Sync Validation Error (shift ${shift.id}): Closed shift lacks counted_cash or closed_at`)
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
        console.error(`POS Sync Error in sync_shift_close (shift ${shift.id}):`, error)
        failedShiftSet.add(shift.id)
        failedShiftIds.push({ id: shift.id, error: error.message || 'Shift close sync failed' })
      } else {
        syncedShiftIds.push(shift.id)
      }
    }

    for (const shift of parsed.data.shifts.filter((item) => item.status === 'open')) {
      if (!failedShiftSet.has(shift.id)) syncedShiftIds.push(shift.id)
    }

    console.log(`Finished POS Sync: syncedSales=${syncedIds.length}, syncedShifts=${syncedShiftIds.length}, failedSales=${failedIds.length}, failedShifts=${failedShiftIds.length}`)

    return NextResponse.json({ success: true, syncedIds, syncedShiftIds, failedIds, failedShiftIds })
  } catch (error) {
    console.error('POS Sync Server Error exception:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error during POS sync' },
      { status: 500 }
    )
  }
}
