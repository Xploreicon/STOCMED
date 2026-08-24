'use client'

import { useEffect, useMemo, useState } from 'react'
import { Eye, Loader2, Mail, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BROADCAST_TEMPLATE_COPY, type BroadcastTemplate } from '@/lib/email/broadcast'

type AudienceKind =
  | 'all_pharmacies' | 'all_patients' | 'premium_pharmacies'
  | 'free_pharmacies' | 'individual_pharmacy' | 'individual_user' | 'custom'

type DirectoryResult = {
  user_id: string
  pharmacy_id: string | null
  email: string
  display_name: string
  detail: string
}

type BroadcastHistory = {
  id: string
  subject: string
  template: BroadcastTemplate
  status: string
  scheduled_at: string | null
  recipient_count: number
  sent_count: number
  delivered_count: number
  failed_count: number
  created_at: string
}

type RecipientDetail = {
  id: string
  recipient_email: string
  display_name: string | null
  delivery_status: string
  provider_status: string | null
  last_error: string | null
}

const audienceOptions: Array<{ value: AudienceKind; label: string }> = [
  { value: 'all_pharmacies', label: 'All pharmacies' },
  { value: 'all_patients', label: 'All patients' },
  { value: 'premium_pharmacies', label: 'Premium pharmacies' },
  { value: 'free_pharmacies', label: 'Free-tier pharmacies' },
  { value: 'individual_pharmacy', label: 'Individual pharmacy' },
  { value: 'individual_user', label: 'Individual user' },
  { value: 'custom', label: 'Custom pharmacy segment' },
]

const featureOptions = [
  'notifications', 'customers', 'credit_sales', 'whatsapp_receipts',
  'staff_accounts', 'smart_reorder', 'unmet_demand_widget',
  'price_benchmark', 'loyalty',
]

export function BroadcastConsole() {
  const defaults = BROADCAST_TEMPLATE_COPY.announcement
  const [template, setTemplate] = useState<BroadcastTemplate>('announcement')
  const [subject, setSubject] = useState(defaults.subject)
  const [body, setBody] = useState(defaults.body)
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('all_pharmacies')
  const [selected, setSelected] = useState<DirectoryResult | null>(null)
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [directoryResults, setDirectoryResults] = useState<DirectoryResult[]>([])
  const [city, setCity] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')
  const [featureKey, setFeatureKey] = useState('')
  const [lastActiveAfter, setLastActiveAfter] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewed, setPreviewed] = useState(false)
  const [busy, setBusy] = useState<'count' | 'preview' | 'send' | 'search' | null>(null)
  const [history, setHistory] = useState<BroadcastHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [detail, setDetail] = useState<{ broadcast: BroadcastHistory; recipients: RecipientDetail[] } | null>(null)

  const audience = useMemo(() => {
    if (audienceKind === 'individual_pharmacy') {
      return { kind: audienceKind, pharmacy_id: selected?.pharmacy_id }
    }
    if (audienceKind === 'individual_user') {
      return { kind: audienceKind, user_id: selected?.user_id }
    }
    if (audienceKind === 'custom') {
      return {
        kind: audienceKind,
        city: city || undefined,
        verification_status: verificationStatus || undefined,
        feature_key: featureKey || undefined,
        feature_enabled: featureKey ? true : undefined,
        last_active_after: lastActiveAfter ? new Date(`${lastActiveAfter}T00:00:00`).toISOString() : undefined,
      }
    }
    return { kind: audienceKind }
  }, [audienceKind, city, featureKey, lastActiveAfter, selected, verificationStatus])

  const payload = useMemo(() => ({
    subject,
    body_markdown: body,
    template,
    audience,
    scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  }), [audience, body, scheduledAt, subject, template])

  const loadHistory = async () => {
    setHistoryLoading(true)
    const response = await fetch('/api/admin/broadcasts', { cache: 'no-store' })
    const result = await response.json().catch(() => null)
    if (response.ok) setHistory(result.broadcasts || [])
    else toast.error(result?.error || 'Could not load broadcast history')
    setHistoryLoading(false)
  }

  useEffect(() => { void loadHistory() }, [])
  useEffect(() => {
    setRecipientCount(null)
    setSelected(null)
    setDirectoryResults([])
  }, [audienceKind])
  useEffect(() => { setPreviewed(false) }, [subject, body, template])

  const applyTemplate = (next: BroadcastTemplate) => {
    setTemplate(next)
    setSubject(BROADCAST_TEMPLATE_COPY[next].subject)
    setBody(BROADCAST_TEMPLATE_COPY[next].body)
    setPreviewHtml('')
  }

  const countAudience = async () => {
    setBusy('count')
    const response = await fetch('/api/admin/broadcasts/audience', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audience),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not calculate the audience')
    else setRecipientCount(result.count)
    setBusy(null)
  }

  const searchDirectory = async () => {
    if (directoryQuery.trim().length < 2) return
    setBusy('search')
    const kind = audienceKind === 'individual_pharmacy' ? 'pharmacy' : 'user'
    const response = await fetch(`/api/admin/broadcasts/directory?kind=${kind}&q=${encodeURIComponent(directoryQuery)}`)
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not search recipients')
    else setDirectoryResults(result.results || [])
    setBusy(null)
  }

  const preview = async () => {
    setBusy('preview')
    const response = await fetch('/api/admin/broadcasts/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not create the preview')
    else {
      setPreviewHtml(result.html)
      setPreviewed(true)
    }
    setBusy(null)
  }

  const sendBroadcast = async () => {
    if (!previewed) return toast.error('Preview the final email before sending')
    if (recipientCount === null) return toast.error('Confirm the recipient count first')
    if (recipientCount < 1) return toast.error('This audience has no subscribed recipients')
    const timing = scheduledAt ? `Schedule for ${new Date(scheduledAt).toLocaleString()}` : 'Send'
    if (!window.confirm(`${timing} to ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}?`)) return
    setBusy('send')
    const response = await fetch('/api/admin/broadcasts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not queue the broadcast')
    else {
      toast.success(`${scheduledAt ? 'Scheduled' : 'Queued'} for ${result.recipient_count} recipient${result.recipient_count === 1 ? '' : 's'}`)
      setRecipientCount(null)
      setPreviewed(false)
      await loadHistory()
    }
    setBusy(null)
  }

  const loadDetail = async (id: string) => {
    const response = await fetch(`/api/admin/broadcasts/${id}`, { cache: 'no-store' })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not load delivery details')
    else setDetail(result)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Mail className="h-4 w-4" /> Admin email</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Broadcasts</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">Compose a branded email, verify its audience, and queue delivery through StocMed’s tracked email outbox.</p>
      </header>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)]">
        <div className="space-y-5 rounded-card border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={template} onChange={event => applyTemplate(event.target.value as BroadcastTemplate)}>
                {Object.entries(BROADCAST_TEMPLATE_COPY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </Field>
            <Field label="Recipients">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={audienceKind} onChange={event => setAudienceKind(event.target.value as AudienceKind)}>
                {audienceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
          </div>

          {(audienceKind === 'individual_pharmacy' || audienceKind === 'individual_user') && (
            <div className="rounded-card border border-border bg-surface p-4">
              <Label htmlFor="recipient-search">Search by {audienceKind === 'individual_pharmacy' ? 'pharmacy name' : 'email'}</Label>
              <div className="mt-2 flex gap-2"><Input id="recipient-search" value={directoryQuery} onChange={event => setDirectoryQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void searchDirectory() } }} /><Button type="button" variant="outline" onClick={searchDirectory} disabled={busy === 'search'}>{busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></div>
              <div className="mt-2 space-y-1">
                {directoryResults.map(result => <button key={`${result.user_id}:${result.pharmacy_id}`} type="button" onClick={() => { setSelected(result); setRecipientCount(null) }} className={`block w-full rounded-md border p-2 text-left text-sm ${selected?.user_id === result.user_id ? 'border-primary bg-white' : 'border-transparent hover:bg-white'}`}><span className="font-semibold text-ink">{result.display_name}</span><span className="block text-xs text-ink-muted">{result.email}{result.detail && result.detail !== result.email ? ` · ${result.detail}` : ''}</span></button>)}
              </div>
            </div>
          )}

          {audienceKind === 'custom' && (
            <div className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-2">
              <Field label="City"><Input value={city} onChange={event => { setCity(event.target.value); setRecipientCount(null) }} placeholder="e.g. Lagos" /></Field>
              <Field label="Verification status"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={verificationStatus} onChange={event => { setVerificationStatus(event.target.value); setRecipientCount(null) }}><option value="">Any status</option><option value="full">Fully verified</option><option value="provisional">Provisional</option><option value="revoked">Revoked</option></select></Field>
              <Field label="Feature usage"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={featureKey} onChange={event => { setFeatureKey(event.target.value); setRecipientCount(null) }}><option value="">Any feature</option>{featureOptions.map(feature => <option key={feature} value={feature}>{feature.replaceAll('_', ' ')}</option>)}</select></Field>
              <Field label="Active since"><Input type="date" value={lastActiveAfter} onChange={event => { setLastActiveAfter(event.target.value); setRecipientCount(null) }} /></Field>
            </div>
          )}

          <Field label="Subject"><Input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} /></Field>
          <Field label="Message (Markdown)"><Textarea className="min-h-64 font-mono text-sm" value={body} maxLength={20000} onChange={event => setBody(event.target.value)} /><p className="mt-1 text-xs text-ink-muted">Use ## for headings, **bold** for emphasis, and - for lists.</p></Field>
          <Field label="Send later (optional)"><Input type="datetime-local" value={scheduledAt} min={new Date().toISOString().slice(0, 16)} onChange={event => setScheduledAt(event.target.value)} /></Field>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={countAudience} disabled={busy !== null}>{busy === 'count' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Check audience</Button>
            <Button type="button" variant="outline" onClick={preview} disabled={busy !== null}><Eye className="mr-2 h-4 w-4" />Preview</Button>
            <Button type="button" onClick={sendBroadcast} disabled={busy !== null || !previewed || recipientCount === null || recipientCount < 1}>{busy === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{scheduledAt ? 'Schedule' : 'Queue send'}</Button>
            {recipientCount !== null && <span className="text-sm font-semibold text-ink">{recipientCount} subscribed recipient{recipientCount === 1 ? '' : 's'}</span>}
          </div>
        </div>

        <div className="min-h-[640px] overflow-hidden rounded-card border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-ink">Email preview</h2><p className="text-xs text-ink-muted">The final unsubscribe link is unique to each recipient.</p></div>
          {previewHtml ? <iframe title="Broadcast email preview" sandbox="" srcDoc={previewHtml} className="h-[760px] w-full bg-white" /> : <div className="flex min-h-[560px] items-center justify-center p-8 text-center text-sm text-ink-muted">Preview the email before sending.</div>}
        </div>
      </section>

      <section className="rounded-card border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold text-ink">Broadcast history</h2><p className="text-sm text-ink-muted">Sent, delivered, and failed counts update from Resend webhooks.</p></div><Button variant="outline" size="sm" onClick={loadHistory}>Refresh</Button></div>
        {historyLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : history.length === 0 ? <p className="p-8 text-sm text-ink-muted">No broadcasts yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-5 py-3">Subject</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Recipients</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Delivered</th><th className="px-4 py-3">Failed</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{history.map(item => <tr key={item.id} onClick={() => void loadDetail(item.id)} className="cursor-pointer border-t border-border hover:bg-surface"><td className="px-5 py-4 font-semibold text-ink">{item.subject}</td><td className="px-4 py-4 text-ink-muted">{new Date(item.created_at).toLocaleString()}</td><td className="px-4 py-4">{item.recipient_count}</td><td className="px-4 py-4">{item.sent_count}</td><td className="px-4 py-4 text-emerald-700">{item.delivered_count}</td><td className="px-4 py-4 text-red-700">{item.failed_count}</td><td className="px-4 py-4"><Status value={item.status} /></td></tr>)}</tbody></table></div>}
      </section>

      {detail && <section className="rounded-card border border-border bg-card"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold text-ink">{detail.broadcast.subject}</h2><p className="text-sm text-ink-muted">Per-recipient delivery status</p></div><Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close</Button></div><div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead className="sticky top-0 bg-surface text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-5 py-3">Recipient</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Provider event</th></tr></thead><tbody>{detail.recipients.map(recipient => <tr key={recipient.id} className="border-t border-border"><td className="px-5 py-3 font-medium text-ink">{recipient.display_name || 'StocMed user'}</td><td className="px-4 py-3 text-ink-muted">{recipient.recipient_email}</td><td className="px-4 py-3"><Status value={recipient.delivery_status} /></td><td className="px-4 py-3 text-xs text-ink-muted">{recipient.last_error || recipient.provider_status || 'Waiting'}</td></tr>)}</tbody></table></div></section>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-2 block">{label}</Label>{children}</div>
}

function Status({ value }: { value: string }) {
  const className = value === 'delivered' || value === 'completed'
    ? 'bg-emerald-50 text-emerald-700'
    : ['failed', 'bounced', 'complained'].includes(value)
      ? 'bg-red-50 text-red-700'
      : 'bg-amber-50 text-amber-800'
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${className}`}>{value.replaceAll('_', ' ')}</span>
}
