'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  isSpAuthorizationRequired,
  spAuthorizationRequiredError,
  withSpAuthorizationHeader,
} from '@/lib/sp-authorization-client'

const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const OUTPUT_SIZE = 512
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'PH'
}

function pharmacyAssetPath(url: string | null, pharmacyId: string) {
  if (!url) return null
  try {
    const marker = '/storage/v1/object/public/pharmacy-assets/'
    const pathname = new URL(url).pathname
    const markerIndex = pathname.indexOf(marker)
    if (markerIndex < 0) return null
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length))
    return path.startsWith(`${pharmacyId}/`) ? path : null
  } catch {
    return null
  }
}

async function compressLogo(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('This image could not be read.'))
      element.src = objectUrl
    })
    const scale = Math.min(1, OUTPUT_SIZE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image compression is not available in this browser.')
    context.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Image compression failed.')),
        'image/webp',
        0.82,
      )
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

interface PharmacyLogoEditorProps {
  pharmacyId: string
  pharmacyName: string
  logoUrl: string | null
  onChanged: (logoUrl: string | null) => void
  authorize: (description: string, operation: (token: string | null) => Promise<void>) => void
}

export function PharmacyLogoEditor({
  pharmacyId,
  pharmacyName,
  logoUrl,
  onChanged,
  authorize,
}: PharmacyLogoEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState(logoUrl)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => setPreview(logoUrl), [logoUrl])

  const updateProfile = async (nextLogoUrl: string | null, token: string | null) => {
    const response = await fetch('/api/pharmacy/profile', {
      method: 'PATCH',
      headers: withSpAuthorizationHeader('pharmacy_settings', token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ logo_url: nextLogoUrl }),
    })
    const body = await response.json().catch(() => null)
    if (response.status === 403 && body?.code === 'SP_AUTH_REQUIRED') {
      throw spAuthorizationRequiredError(body?.error || 'Superintendent authorization is required.')
    }
    if (!response.ok) throw new Error(body?.error || 'Could not update the pharmacy logo.')
  }

  const upload = async (file: File, token: string | null) => {
    if (!ALLOWED_TYPES.has(file.type)) {
      toast.error('Choose a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error('Logo images must be 5 MB or smaller.')
      return
    }

    setIsSaving(true)
    try {
      const compressed = await compressLogo(file)
      const supabase = createClient()
      const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `${pharmacyId}/logo-${suffix}.webp`
      const { error } = await supabase.storage
        .from('pharmacy-assets')
        .upload(path, compressed, {
          contentType: 'image/webp',
          cacheControl: '3600',
          upsert: true,
        })
      if (error) throw error
      const { data } = supabase.storage.from('pharmacy-assets').getPublicUrl(path)
      const publicUrl = `${data.publicUrl}?v=${Date.now()}`
      try {
        await updateProfile(publicUrl, token)
      } catch (updateError) {
        const { error: cleanupError } = await supabase.storage.from('pharmacy-assets').remove([path])
        if (cleanupError) {
          toast.error(`The logo change was rejected, and its temporary upload could not be removed: ${cleanupError.message}`)
        }
        throw updateError
      }
      const previousPath = pharmacyAssetPath(preview, pharmacyId)
      if (previousPath && previousPath !== path) {
        const { error: cleanupError } = await supabase.storage.from('pharmacy-assets').remove([previousPath])
        if (cleanupError) toast.error(`Logo updated, but the previous image could not be removed: ${cleanupError.message}`)
      }
      setPreview(publicUrl)
      onChanged(publicUrl)
      toast.success('Pharmacy logo updated')
    } catch (error) {
      if (isSpAuthorizationRequired(error)) throw error
      toast.error(error instanceof Error ? error.message : 'Could not upload the logo.')
    } finally {
      setIsSaving(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (token: string | null) => {
    setIsSaving(true)
    try {
      await updateProfile(null, token)
      const supabase = createClient()
      const currentPath = pharmacyAssetPath(preview, pharmacyId)
      if (currentPath) {
        const { error: cleanupError } = await supabase.storage.from('pharmacy-assets').remove([currentPath])
        if (cleanupError) toast.error(`Logo removed from the pharmacy profile, but the old image file could not be deleted: ${cleanupError.message}`)
      }
      setPreview(null)
      onChanged(null)
      toast.success('Pharmacy logo removed')
    } catch (error) {
      if (isSpAuthorizationRequired(error)) throw error
      toast.error(error instanceof Error ? error.message : 'Could not remove the logo.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="rounded-card border border-border bg-white p-4 sm:p-5" aria-labelledby="pharmacy-logo-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-primary/10 text-xl font-semibold text-primary">
          {preview ? (
            // A plain img is intentional: pharmacy URLs are dynamic Supabase storage URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt={`${pharmacyName} logo`}
              className="h-full w-full object-cover"
              onError={() => setPreview(null)}
            />
          ) : initials(pharmacyName)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="pharmacy-logo-heading" className="text-[15px] font-semibold text-ink">Pharmacy logo</h2>
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">
            Shown on your dashboard, receipts, and patient search results. PNG, JPEG, or WebP · 5 MB maximum.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) authorize('Authorise changing the pharmacy logo', async (token) => upload(file, token))
              }}
            />
            <Button type="button" disabled={isSaving} onClick={() => inputRef.current?.click()} className="h-11 gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {preview ? 'Replace logo' : 'Upload logo'}
            </Button>
            {preview && (
              <Button type="button" disabled={isSaving} onClick={() => authorize('Authorise removing the pharmacy logo', remove)} variant="outline" className="h-11 gap-2 border-danger text-danger hover:bg-danger/5">
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
