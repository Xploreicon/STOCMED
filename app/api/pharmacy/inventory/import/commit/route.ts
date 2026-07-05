import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

    // Check authentication
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

    const { matchedRows } = await request.json()

    if (!matchedRows || !Array.isArray(matchedRows)) {
      return NextResponse.json(
        { error: 'Invalid payload: matchedRows must be an array' },
        { status: 400 }
      )
    }

    const encoder = new TextEncoder()

    // Setup ReadableStream for Server-Sent Events (SSE)
    const stream = new ReadableStream({
      async start(controller) {
        const sendUpdate = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        let imported = 0
        let skipped = 0
        let errors = 0
        const total = matchedRows.length

        sendUpdate({ status: 'started', progress: 0, imported, skipped, errors, total })

        for (let i = 0; i < total; i++) {
          const row = matchedRows[i]
          const { mapped, selected_product_id } = row
          
          try {
            // Call the database function to import the row atomically
            const { data: res, error: rpcErr } = await supabase.rpc('import_inventory_row', {
              p_pharmacy_id: pharmacy.id,
              p_user_id: user.id,
              p_selected_product_id: selected_product_id || '',
              p_mapped: mapped
            })

            if (rpcErr) {
              throw new Error(`RPC call failed: ${rpcErr.message}`)
            }

            if (!res || !(res as any).success) {
              throw new Error(`Database import failed: ${(res as any)?.error || 'Unknown error'}`)
            }

            imported++
          } catch (err: any) {
            console.error(`Error importing row ${i + 1}:`, err)
            errors++
          }

          // Send periodic progress
          const progress = Math.round(((i + 1) / total) * 100)
          sendUpdate({ status: 'running', progress, imported, skipped, errors, total })
        }

        sendUpdate({ status: 'completed', progress: 100, imported, skipped, errors, total })
        controller.close()
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  } catch (error: any) {
    console.error('Import commit error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error committing import' },
      { status: 500 }
    )
  }
}
