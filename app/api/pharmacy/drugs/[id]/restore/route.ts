import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'
import { SP_AUTH_REQUIRED_RESPONSE } from '@/lib/sp-authorization'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const pharmacy = await ensurePharmacyRecord(supabase, user)

    if (!pharmacy) {
      return NextResponse.json(
        { error: 'Pharmacy profile not found. Complete your setup to continue.' },
        { status: 404 }
      )
    }

    // Verify drug belongs to this pharmacy and is actually delisted
    const { data: existingDrug, error: checkError } = await (supabase as any)
      .from('pharmacy_inventory')
      .select('pharmacy_id, deleted_at')
      .eq('id', id)
      .single()

    if (checkError || !existingDrug) {
      return NextResponse.json(
        { error: 'Drug not found' },
        { status: 404 }
      )
    }

    if ((existingDrug as any).pharmacy_id !== pharmacy.id) {
      return NextResponse.json(
        { error: 'Forbidden: Drug does not belong to your pharmacy' },
        { status: 403 }
      )
    }

    if (!(existingDrug as any).deleted_at) {
      return NextResponse.json(
        { error: 'This item is already active in your inventory.' },
        { status: 400 }
      )
    }

    const { data: restoreResult, error: updateError } = await (supabase.rpc as any)(
      'restore_pharmacy_inventory_item',
      {
        p_inventory_id: id,
        p_sp_token: request.headers.get('x-sp-authorization'),
      },
    )

    if (updateError) {
      console.error('Error restoring drug:', updateError)
      return NextResponse.json(
        { error: updateError.message || 'Failed to restore drug to inventory' },
        { status: 409 }
      )
    }
    if (restoreResult?.success === false) {
      if (restoreResult.code === 'SP_AUTH_REQUIRED') {
        return NextResponse.json(SP_AUTH_REQUIRED_RESPONSE, { status: 403 })
      }
      return NextResponse.json(
        { error: restoreResult.error || 'Failed to restore drug to inventory', code: restoreResult.code },
        { status: restoreResult.code === 'NOT_FOUND' ? 404 : 409 },
      )
    }

    return NextResponse.json({
      message: 'Drug restored to active inventory.',
      id,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
