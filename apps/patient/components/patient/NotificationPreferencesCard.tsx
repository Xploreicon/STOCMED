'use client'

import { usePatientFetch } from '@/hooks/usePatientFetch'
import { isPatientAbort } from '@/lib/patient-operation'

import { useEffect, useState } from 'react'
import { Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

type Preferences = {
  product_email_opt_in: boolean
  refill_email_opt_in: boolean
  reminder_sms_opt_in: boolean
  patient_email_consent: boolean
  patient_sms_consent: boolean
  patient_push_consent: boolean
}

const preferenceFields = [
  'product_email_opt_in',
  'refill_email_opt_in',
  'reminder_sms_opt_in',
  'patient_email_consent',
  'patient_sms_consent',
  'patient_push_consent',
] as const

function isPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return preferenceFields.every(key => typeof record[key] === 'boolean')
}

export function NotificationPreferencesCard() {
  const nativeFetch = usePatientFetch()
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    nativeFetch('/api/notifications/preferences')
      .then(async response => {
        if (!response.ok) throw new Error('Could not load notification preferences')
        const result = await response.json()
        const incoming = result?.preferences
        if (!isPreferences(incoming)) {
          throw new Error('Incomplete notification preferences')
        }
        if (active) setPreferences(incoming)
      })
      .catch(error => {
        if (active && !isPatientAbort(error)) setPreferences(null)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [nativeFetch, loadAttempt])

  const update = async (patch: Partial<Preferences>) => {
    if (!preferences || saving) return
    const next = { ...preferences, ...patch }
    setSaving(true)
    try {
      const response = await nativeFetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !isPreferences(result?.preferences)) {
        toast.error(result?.error || 'Could not save notification preferences')
      } else {
        setPreferences(result.preferences)
        toast.success('Notification preferences saved')
      }
    } catch (error) {
      if (isPatientAbort(error)) return
      toast.error('Could not save notification preferences. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div>
          <CardTitle>Notifications</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">Nothing is enabled by default. Change these choices at any time.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading notification preferences" /> : !preferences ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-ink-muted">Could not load notification preferences.</p>
            <Button type="button" variant="outline" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry preferences</Button>
          </div>
        ) : (
          <>
            <Preference
              id="patient-email-consent"
              checked={preferences.patient_email_consent}
              disabled={saving}
              onChange={checked => update({ patient_email_consent: checked })}
              label="Allow email notifications"
              detail="Permission for the email choices below. Turning this off stops optional patient email."
            />
            <Preference
              id="patient-sms-consent"
              checked={preferences.patient_sms_consent}
              disabled={saving}
              onChange={checked => update({ patient_sms_consent: checked })}
              label="Allow SMS notifications"
              detail="Permission for optional text reminders. Reservation confirmations you request remain transactional."
            />
            <Preference
              id="product-email"
              checked={preferences.product_email_opt_in && preferences.patient_email_consent}
              disabled={saving}
              onChange={checked => update({ product_email_opt_in: checked, patient_email_consent: checked || preferences.patient_email_consent })}
              label="Product email"
              detail="Receive opted-in reports, receipts, and useful StocMed updates. Security email is always separate."
            />
            <Preference
              id="refill-email"
              checked={preferences.refill_email_opt_in && preferences.patient_email_consent}
              disabled={saving}
              onChange={checked => update({ refill_email_opt_in: checked, patient_email_consent: checked || preferences.patient_email_consent })}
              label="Refill reminder email"
              detail="Receive a reminder when a saved refill may be due."
            />
            <Preference
              id="reservation-reminder-sms"
              checked={preferences.reminder_sms_opt_in && preferences.patient_sms_consent}
              disabled={saving}
              onChange={checked => update({ reminder_sms_opt_in: checked, patient_sms_consent: checked || preferences.patient_sms_consent })}
              label="Reservation reminder SMS"
              detail="Receive one reminder shortly before an active hold expires. The initial hold confirmation is transactional."
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Preference(props: {
  id: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={props.id} checked={props.checked} disabled={props.disabled} onCheckedChange={value => props.onChange(value === true)} className="mt-1" />
      <div>
        <Label htmlFor={props.id}>{props.label}</Label>
        <p className="text-sm text-ink-muted">{props.detail}</p>
      </div>
    </div>
  )
}
