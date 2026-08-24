'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Preferences = {
  owner_phone: string
  owner_email: string
  reservation_sms_opt_in: boolean
  stock_digest_sms_opt_in: boolean
  daily_sms_cap: number
  low_stock_email_opt_in: boolean
  low_stock_sms_opt_in: boolean
  expiry_email_opt_in: boolean
  expiry_sms_opt_in: boolean
  daily_summary_email_opt_in: boolean
  daily_summary_sms_opt_in: boolean
  search_digest_email_opt_in: boolean
  daily_email_cap: number
}

export default function PharmacyNotificationSettingsPage() {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/pharmacy/notifications')
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        setPreferences(result.preferences)
      })
      .catch(error => toast.error(error.message || 'Could not load notification settings'))
  }, [])

  const save = async () => {
    if (!preferences) return
    setSaving(true)
    const response = await fetch('/api/pharmacy/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not save notification settings')
    else {
      setPreferences(result.preferences)
      toast.success('Notification settings saved')
    }
    setSaving(false)
  }

  if (!preferences) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  return (
    <div className="mx-auto max-w-2xl pb-12">
      <Link href="/pharmacy/settings/features" className="text-sm font-medium text-primary">← Features</Link>
      <h1 className="mt-4 text-3xl font-semibold text-ink">Owner updates</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">In-app updates are always available while this feature is on. Email and SMS remain off until you choose them.</p>

      <div className="mt-7 space-y-6 rounded-card border border-border bg-card p-6">
        <label className="block">
          <span className="text-sm font-medium text-ink">Owner mobile number</span>
          <Input className="mt-2" value={preferences.owner_phone} onChange={event => setPreferences({ ...preferences, owner_phone: event.target.value })} placeholder="+2348031234567" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Owner email</span>
          <Input className="mt-2" type="email" value={preferences.owner_email} onChange={event => setPreferences({ ...preferences, owner_email: event.target.value })} placeholder="owner@pharmacy.example" />
        </label>
        <Choice
          id="reservation-owner-sms"
          checked={preferences.reservation_sms_opt_in}
          onChange={checked => setPreferences({ ...preferences, reservation_sms_opt_in: checked })}
          label="New reservation SMS"
          detail="Send the owner one SMS when a patient places a hold."
        />
        <ChannelChoices
          id="low-stock"
          label="Low-stock warning"
          detail="One daily update when an item reaches its reorder level."
          email={preferences.low_stock_email_opt_in}
          sms={preferences.low_stock_sms_opt_in}
          onEmail={checked => setPreferences({ ...preferences, low_stock_email_opt_in: checked })}
          onSms={checked => setPreferences({ ...preferences, low_stock_sms_opt_in: checked, stock_digest_sms_opt_in: checked || preferences.expiry_sms_opt_in })}
        />
        <ChannelChoices
          id="expiry"
          label="Expiry warning"
          detail="One daily update for batches expiring within 30 days."
          email={preferences.expiry_email_opt_in}
          sms={preferences.expiry_sms_opt_in}
          onEmail={checked => setPreferences({ ...preferences, expiry_email_opt_in: checked })}
          onSms={checked => setPreferences({ ...preferences, expiry_sms_opt_in: checked, stock_digest_sms_opt_in: checked || preferences.low_stock_sms_opt_in })}
        />
        <ChannelChoices
          id="daily-summary"
          label="Daily sales summary"
          detail="Sales total, transaction count, and average sale at the end of the day."
          email={preferences.daily_summary_email_opt_in}
          sms={preferences.daily_summary_sms_opt_in}
          onEmail={checked => setPreferences({ ...preferences, daily_summary_email_opt_in: checked })}
          onSms={checked => setPreferences({ ...preferences, daily_summary_sms_opt_in: checked })}
        />
        <Choice
          id="search-demand-email"
          checked={preferences.search_digest_email_opt_in}
          onChange={checked => setPreferences({ ...preferences, search_digest_email_opt_in: checked })}
          label="Daily local medication-demand email"
          detail="One email each day when patients near your pharmacy searched for catalogue medications. Includes both stocked and unmet demand."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Daily SMS cap</span>
            <Input className="mt-2 max-w-32" type="number" min={1} max={100} value={preferences.daily_sms_cap} onChange={event => setPreferences({ ...preferences, daily_sms_cap: Number(event.target.value) })} />
            <span className="mt-1 block text-xs text-ink-muted">Maximum SMS linked to this pharmacy each day.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Daily email cap</span>
            <Input className="mt-2 max-w-32" type="number" min={1} max={100} value={preferences.daily_email_cap} onChange={event => setPreferences({ ...preferences, daily_email_cap: Number(event.target.value) })} />
            <span className="mt-1 block text-xs text-ink-muted">Maximum email linked to this pharmacy each day.</span>
          </label>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save choices'}</Button>
      </div>
    </div>
  )
}

function ChannelChoices(props: {
  id: string
  label: string
  detail: string
  email: boolean
  sms: boolean
  onEmail: (checked: boolean) => void
  onSms: (checked: boolean) => void
}) {
  return (
    <fieldset className="rounded-card border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{props.label}</legend>
      <p className="text-sm text-ink-muted">{props.detail}</p>
      <div className="mt-3 flex flex-wrap gap-5">
        <Choice id={`${props.id}-email`} checked={props.email} onChange={props.onEmail} label="Email" detail="" />
        <Choice id={`${props.id}-sms`} checked={props.sms} onChange={props.onSms} label="SMS" detail="" />
      </div>
    </fieldset>
  )
}

function Choice(props: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={props.id} checked={props.checked} onCheckedChange={value => props.onChange(value === true)} className="mt-1" />
      <div><Label htmlFor={props.id}>{props.label}</Label><p className="text-sm text-ink-muted">{props.detail}</p></div>
    </div>
  )
}
