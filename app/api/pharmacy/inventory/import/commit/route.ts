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
            let productId = selected_product_id

            // Step 1: Create unverified product if selected_product_id is 'create_new'
            if (productId === 'create_new' || !productId) {
              const { data: newProd, error: prodErr } = await supabase
                .from('products')
                .insert({
                  generic_name: mapped.generic_name,
                  brand_name: mapped.brand_name || null,
                  strength: mapped.strength || 'unspecified',
                  dosage_form: mapped.dosage_form || 'Tablet',
                  category: mapped.category || 'Others',
                  pack_size: mapped.pack_size || null,
                  is_verified: false
                })
                .select()
                .single()

              if (prodErr || !newProd) {
                throw new Error(`Failed to create product catalogue item: ${prodErr?.message}`)
              }
              productId = (newProd as any).id
            }

            // Step 2: Ensure pharmacy_inventory record exists
            let inventoryId = ''
            
            // Check existing
            const { data: existingInv } = await supabase
              .from('pharmacy_inventory')
              .select('id')
              .eq('pharmacy_id', pharmacy.id)
              .eq('product_id', productId)
              .maybeSingle()

            if (existingInv) {
              inventoryId = (existingInv as any).id
              // Update price if mapping provided it
              if (mapped.price) {
                await supabase
                  .from('pharmacy_inventory')
                  .update({ price: mapped.price })
                  .eq('id', inventoryId)
              }
            } else {
              const { data: newInv, error: invErr } = await supabase
                .from('pharmacy_inventory')
                .insert({
                  pharmacy_id: pharmacy.id,
                  product_id: productId,
                  price: mapped.price || 0,
                  low_stock_threshold: 10,
                  quantity_in_stock: 0,
                  is_listed: true
                })
                .select()
                .single()

              if (invErr || !newInv) {
                throw new Error(`Failed to create inventory row: ${invErr?.message}`)
              }
              inventoryId = (newInv as any).id
            }

            // Step 3: Insert batch record
            const { data: batch, error: batchErr } = await supabase
              .from('batches')
              .insert({
                inventory_id: inventoryId,
                batch_number: mapped.batch_number || `BATCH-${Date.now()}`,
                expiry_date: mapped.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                quantity_received: mapped.quantity || 0,
                cost_price: null
              })
              .select()
              .single()

            if (batchErr || !batch) {
              throw new Error(`Failed to create batch: ${batchErr?.message}`)
            }

            const { error: moveErr } = await supabase
              .from('stock_movements')
              .insert({
                inventory_id: inventoryId,
                batch_id: (batch as any).id,
                type: 'opening',
                quantity: mapped.quantity || 0,
                reason: 'Opening stock (Imported)',
                created_by: user.id
              })

            if (moveErr) {
              throw new Error(`Failed to insert stock movement: ${moveErr?.message}`)
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
