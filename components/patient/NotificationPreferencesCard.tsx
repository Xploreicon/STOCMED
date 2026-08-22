'use client'

import { useEffect, useState } from 'react'
import { Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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

const defaults: Preferences = {
  product_email_opt_in: false,
  refill_email_opt_in: false,
  reminder_sms_opt_in: false,
  patient_email_consent: false,
  patient_sms_consent: false,
  patient_push_consent: false,
}

export function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/notifications/preferences')
      .then(response => response.json())
      .then(result => setPreferences(result.preferences || defaults))
      .catch(() => toast.error('Could not load notification preferences'))
      .finally(() => setLoading(false))
  }, [])

  const update = async (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch }
    setSaving(true)
    const response = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      toast.error(result?.error || 'Could not save notification preferences')
    } else {
      setPreferences(result.preferences)
      toast.success('Notification preferences saved')
    }
    setSaving(false)
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
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : (
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
