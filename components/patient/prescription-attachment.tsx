'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_PHOTO_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_EDGE = 2560

async function stripJpegMetadata(jpeg: Blob): Promise<Blob[]> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  const parts: Blob[] = []
  let keptFrom = 0
  let offset = 2
  while (bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    // Scan data begins here. Its bytes are compressed pixels, not header segments.
    if (marker === 0xda || marker === 0xd9) break

    const length = bytes[offset + 2] * 256 + bytes[offset + 3]
    const end = offset + 2 + length
    if (!(length >= 2 && end <= bytes.length)) {
      throw new Error('This photo could not be prepared. Choose another photo.')
    }

    // WebKit may write a fresh EXIF header even when encoding a new canvas.
    // Remove APP1 (EXIF/XMP) and JPEG comments while preserving colour profiles.
    if (marker === 0xe1 || marker === 0xfe) {
      parts.push(jpeg.slice(keptFrom, offset))
      keptFrom = end
    }
    offset = end
  }
  parts.push(jpeg.slice(keptFrom))
  return parts
}

export async function preparePrescriptionAttachment(file: File): Promise<File> {
  if (file.type === 'application/pdf') {
    if (!file.size || file.size > MAX_UPLOAD_BYTES) {
      throw new Error('Choose a PDF no larger than 5 MB.')
    }
    return file
  }
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    throw new Error('Choose a JPEG, PNG, or PDF prescription.')
  }
  if (!file.size || file.size > MAX_PHOTO_BYTES) {
    throw new Error('Choose a photo no larger than 24 MB.')
  }

  const source = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = source
    await image.decode().catch(() => {
      throw new Error('This photo could not be opened. Choose another photo.')
    })

    // The browser decodes the source orientation before drawing the image.
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('This photo could not be prepared. Choose another photo.')

    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!jpeg || jpeg.type !== 'image/jpeg' || !jpeg.size) {
      throw new Error('This photo could not be prepared. Choose another photo.')
    }
    const prepared = new File(await stripJpegMetadata(jpeg), 'prescription.jpg', { type: jpeg.type })
    if (prepared.size > MAX_UPLOAD_BYTES) {
      throw new Error('This photo could not be prepared. Choose a smaller photo or a PDF.')
    }
    return prepared
  } finally {
    URL.revokeObjectURL(source)
  }
}

export function usePrescriptionAttachment() {
  const inputRef = useRef<HTMLInputElement>(null)
  const revision = useRef(0)
  const preview = useRef<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clear = useCallback(() => {
    const current = ++revision.current
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = null
    setFile(null)
    setPreviewUrl(null)
    setPreparing(false)
    setError(null)
    return current
  }, [])

  useEffect(() => () => {
    revision.current += 1
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = null
  }, [])

  const reset = useCallback(() => {
    clear()
    if (inputRef.current) inputRef.current.value = ''
  }, [clear])

  async function select(selected: File | null) {
    const current = clear()
    if (!selected) return
    setPreparing(true)
    try {
      const prepared = await preparePrescriptionAttachment(selected)
      if (current !== revision.current) return
      if (prepared.type === 'image/jpeg') {
        preview.current = URL.createObjectURL(prepared)
        setPreviewUrl(preview.current)
      }
      setFile(prepared)
    } catch (cause) {
      if (current !== revision.current) return
      if (inputRef.current) inputRef.current.value = ''
      setError(cause instanceof Error ? cause.message : 'Choose another prescription file.')
    } finally {
      if (current === revision.current) setPreparing(false)
    }
  }

  return { inputRef, file, previewUrl, preparing, error, select, reset }
}

export function PrescriptionAttachmentPreview({ url, preparing, error }: {
  url: string | null
  preparing: boolean
  error: string | null
}) {
  if (preparing) return <p role="status" className="text-sm text-ink-muted">Preparing prescription…</p>
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>
  if (!url) return null
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm text-ink-muted">
        Check that the whole prescription is readable before sending it.
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- The preview is a local object URL. */}
      <img src={url} alt="Prepared prescription preview" className="h-auto max-w-full rounded-button border border-border" />
    </figure>
  )
}
