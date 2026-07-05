import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

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

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // Get raw rows
    const rawData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 })

    if (rawData.length === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 })
    }

    // Clean headers and filter out empty columns
    const rawHeaders = (rawData[0] || []) as any[]
    const headers = rawHeaders.map((h, index) => (h ? String(h).trim() : `Column_${index + 1}`))

    // Parse records
    const rows = rawData.slice(1)
      .filter((row: any[]) => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))
      .map((row: any[]) => {
        const obj: Record<string, any> = {}
        headers.forEach((header, index) => {
          obj[header] = row[index] !== undefined ? row[index] : ''
        })
        return obj
      })

    return NextResponse.json({ headers, rows })
  } catch (error: any) {
    console.error('Parse file error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error while parsing file' },
      { status: 500 }
    )
  }
}
