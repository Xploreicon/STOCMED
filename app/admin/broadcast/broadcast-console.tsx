'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Eye, History, LayoutTemplate, Loader2, Mail, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { BROADCAST_TEMPLATE_COPY, type BroadcastTemplate } from '@/lib/email/broadcast'

type AudienceKind =
  | 'all_users' | 'all_pharmacies' | 'all_patients' | 'premium_pharmacies'
  | 'free_pharmacies' | 'individual_pharmacy' | 'individual_user' | 'custom'
type BodyFormat = 'markdown' | 'html'

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
  { value: 'all_users', label: 'All users' },
  { value: 'all_patients', label: 'All patients' },
  { value: 'all_pharmacies', label: 'All pharmacies' },
  { value: 'premium_pharmacies', label: 'Premium pharmacies' },
  { value: 'free_pharmacies', label: 'Non-premium (free) pharmacies' },
  { value: 'individual_pharmacy', label: 'Individual pharmacy' },
  { value: 'individual_user', label: 'Individual user' },
  { value: 'custom', label: 'Custom pharmacy segment' },
]

const featureOptions = [
  'notifications', 'customers', 'credit_sales', 'whatsapp_receipts',
  'staff_accounts', 'smart_reorder', 'unmet_demand_widget', 'price_benchmark', 'loyalty',
]

export function BroadcastConsole() {
  const defaults = BROADCAST_TEMPLATE_COPY.announcement
  const [activeTab, setActiveTab] = useState('compose')
  const [template, setTemplate] = useState<BroadcastTemplate>('announcement')
  const [subject, setSubject] = useState(defaults.subject)
  const [body, setBody] = useState(defaults.body)
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>('markdown')
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('all_users')
  const [selected, setSelected] = useState<DirectoryResult | null>(null)
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [directoryResults, setDirectoryResults] = useState<DirectoryResult[]>([])
  const [city, setCity] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')
  const [featureKey, setFeatureKey] = useState('')
  const [lastActiveAfter, setLastActiveAfter] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const [countError, setCountError] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewed, setPreviewed] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sendBusy, setSendBusy] = useState<'test' | 'broadcast' | null>(null)
  const [history, setHistory] = useState<BroadcastHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [detail, setDetail] = useState<{ broadcast: BroadcastHistory; recipients: RecipientDetail[] } | null>(null)
  const [pushTitle, setPushTitle] = useState('An update from StocMed')
  const [pushBody, setPushBody] = useState('Open StocMed to see the latest update.')
  const [pushHref, setPushHref] = useState('/dashboard')
  const [pushCount, setPushCount] = useState<number | null>(null)
  const [pushCountLoading, setPushCountLoading] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushRequestId, setPushRequestId] = useState('')

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

  const audienceReady = useMemo(() => {
    if (audienceKind === 'individual_pharmacy') return Boolean(selected?.pharmacy_id)
    if (audienceKind === 'individual_user') return Boolean(selected?.user_id)
    if (audienceKind === 'custom') return Boolean(city || verificationStatus || featureKey || lastActiveAfter)
    return true
  }, [audienceKind, city, featureKey, lastActiveAfter, selected, verificationStatus])

  const payload = useMemo(() => ({
    subject,
    body_markdown: body,
    body_format: bodyFormat,
    template,
    audience,
    scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  }), [audience, body, bodyFormat, scheduledAt, subject, template])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const response = await fetch('/api/admin/broadcasts', { cache: 'no-store' })
    const result = await response.json().catch(() => null)
    if (response.ok) setHistory(result.broadcasts || [])
    else toast.error(result?.error || 'Could not load broadcast history')
    setHistoryLoading(false)
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => { setPushRequestId(crypto.randomUUID()) }, [])
  useEffect(() => {
    setSelected(null)
    setDirectoryQuery('')
    setDirectoryResults([])
  }, [audienceKind])
  useEffect(() => { setPreviewed(false) }, [subject, body, bodyFormat, template])

  useEffect(() => {
    if (!audienceReady) {
      setRecipientCount(null)
      setPushCount(null)
      setCountLoading(false)
      setPushCountLoading(false)
      setCountError('')
      return
    }
    setRecipientCount(null)
    setPushCount(null)
    setCountLoading(true)
    setPushCountLoading(true)
    setCountError('')
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setCountError('')
      try {
        const [emailResponse, pushResponse] = await Promise.all([
          fetch('/api/admin/broadcasts/audience', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(audience), signal: controller.signal,
          }),
          fetch('/api/admin/push/audience', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(audience), signal: controller.signal,
          }),
        ])
        const [emailResult, pushResult] = await Promise.all([
          emailResponse.json().catch(() => null), pushResponse.json().catch(() => null),
        ])
        if (!emailResponse.ok) throw new Error(emailResult?.error || 'Could not calculate the email audience')
        setRecipientCount(emailResult.count)
        setPushCount(pushResponse.ok ? pushResult.count : null)
      } catch (error) {
        if (!controller.signal.aborted) {
          setRecipientCount(null)
          setPushCount(null)
          setCountError(error instanceof Error ? error.message : 'Could not calculate this audience')
        }
      } finally {
        if (!controller.signal.aborted) {
          setCountLoading(false)
          setPushCountLoading(false)
        }
      }
    }, 350)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [audience, audienceReady])

  useEffect(() => {
    if (!['individual_pharmacy', 'individual_user'].includes(audienceKind) || directoryQuery.trim().length < 2) {
      setDirectoryResults([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const kind = audienceKind === 'individual_pharmacy' ? 'pharmacy' : 'user'
      const response = await fetch(`/api/admin/broadcasts/directory?kind=${kind}&q=${encodeURIComponent(directoryQuery)}`, { signal: controller.signal })
      const result = await response.json().catch(() => null)
      if (response.ok) setDirectoryResults(result.results || [])
      else if (!controller.signal.aborted) toast.error(result?.error || 'Could not search recipients')
    }, 300)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [audienceKind, directoryQuery])

  const requestPreview = useCallback(async (quiet = false) => {
    if (!subject.trim() || !body.trim() || !audienceReady) return
    setPreviewLoading(true)
    const response = await fetch('/api/admin/broadcasts/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      if (!quiet) toast.error(result?.error || 'Could not create the preview')
    } else {
      setPreviewHtml(result.html)
      setPreviewed(true)
    }
    setPreviewLoading(false)
  }, [audienceReady, body, payload, subject])

  useEffect(() => {
    const timer = window.setTimeout(() => { void requestPreview(true) }, 500)
    return () => window.clearTimeout(timer)
  }, [requestPreview])

  const applyTemplate = (next: BroadcastTemplate) => {
    setTemplate(next)
    setSubject(BROADCAST_TEMPLATE_COPY[next].subject)
    setBody(BROADCAST_TEMPLATE_COPY[next].body)
    setBodyFormat('markdown')
    setActiveTab('compose')
  }

  const sendTest = async () => {
    setSendBusy('test')
    const response = await fetch('/api/admin/broadcasts/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body_markdown: body, body_format: bodyFormat, template }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not send the test email')
    else {
      toast.success('One branded test email was sent to your admin inbox')
      await loadHistory()
    }
    setSendBusy(null)
  }

  const sendBroadcast = async () => {
    if (!previewed) return toast.error('Preview the final email before sending')
    if (recipientCount === null) return toast.error('Wait for the live recipient count')
    if (recipientCount < 1) return toast.error('This audience has no subscribed recipients')
    const timing = scheduledAt ? `Schedule for ${new Date(scheduledAt).toLocaleString()}` : 'Send'
    if (!window.confirm(`${timing} to ${recipientCount} user${recipientCount === 1 ? '' : 's'}?`)) return
    setSendBusy('broadcast')
    const response = await fetch('/api/admin/broadcasts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not queue the broadcast')
    else {
      toast.success(`${scheduledAt ? 'Scheduled' : 'Queued'} for ${result.recipient_count} user${result.recipient_count === 1 ? '' : 's'}`)
      setPreviewed(false)
      await loadHistory()
    }
    setSendBusy(null)
  }

  const sendPush = async () => {
    if (pushCount === null) return toast.error('Wait for the live push recipient count')
    if (pushCount < 1) return toast.error('No subscribed devices match this audience')
    if (!window.confirm(`Send this push notification to ${pushCount} subscribed user${pushCount === 1 ? '' : 's'}?`)) return
    setPushBusy(true)
    const response = await fetch('/api/admin/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: pushTitle, body: pushBody, href: pushHref, audience,
        request_id: pushRequestId || crypto.randomUUID(),
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not queue the push notification')
    else {
      toast.success(`Queued ${result.queued} push deliver${result.queued === 1 ? 'y' : 'ies'} across ${result.recipient_count} user${result.recipient_count === 1 ? '' : 's'}`)
      setPushRequestId(crypto.randomUUID())
    }
    setPushBusy(false)
  }

  const loadDetail = async (id: string) => {
    const response = await fetch(`/api/admin/broadcasts/${id}`, { cache: 'no-store' })
    const result = await response.json().catch(() => null)
    if (!response.ok) toast.error(result?.error || 'Could not load delivery details')
    else setDetail(result)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Mail className="h-4 w-4" /> Admin messaging</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Broadcasts</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">Compose branded email and browser push notifications, verify the audience live, and queue every delivery through the tracked outbox.</p>
      </header>

      <Tabs defaultValue="compose" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="compose"><Mail className="mr-2 h-4 w-4" />Compose Email</TabsTrigger>
          <TabsTrigger value="templates"><LayoutTemplate className="mr-2 h-4 w-4" />Templates</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-2 h-4 w-4" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="space-y-7">
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)]">
            <div className="space-y-5 rounded-card border border-border bg-card p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Load Template (optional)">
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={template} onChange={event => applyTemplate(event.target.value as BroadcastTemplate)}>
                    {Object.entries(BROADCAST_TEMPLATE_COPY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                  </select>
                </Field>
                <Field label="Recipients">
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={audienceKind} onChange={event => setAudienceKind(event.target.value as AudienceKind)}>
                    {audienceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <AudienceCount loading={countLoading} count={recipientCount} empty={!audienceReady} error={countError} />
                </Field>
              </div>

              {(audienceKind === 'individual_pharmacy' || audienceKind === 'individual_user') && (
                <div className="rounded-card border border-border bg-surface p-4">
                  <Label htmlFor="recipient-search">Search by {audienceKind === 'individual_pharmacy' ? 'pharmacy name' : 'email'}</Label>
                  <div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-ink-muted" /><Input id="recipient-search" className="pl-9" value={directoryQuery} onChange={event => setDirectoryQuery(event.target.value)} placeholder={audienceKind === 'individual_pharmacy' ? 'Start typing a pharmacy name' : 'Start typing an email address'} /></div>
                  <div className="mt-2 space-y-1">
                    {directoryResults.map(result => <button key={`${result.user_id}:${result.pharmacy_id}`} type="button" onClick={() => setSelected(result)} className={`block w-full rounded-md border p-2 text-left text-sm ${selected?.user_id === result.user_id ? 'border-primary bg-white' : 'border-transparent hover:bg-white'}`}><span className="font-semibold text-ink">{result.display_name}</span><span className="block text-xs text-ink-muted">{result.email}{result.detail && result.detail !== result.email ? ` · ${result.detail}` : ''}</span></button>)}
                  </div>
                </div>
              )}

              {audienceKind === 'custom' && (
                <div className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-2">
                  <Field label="City"><Input value={city} onChange={event => setCity(event.target.value)} placeholder="e.g. Lagos" /></Field>
                  <Field label="Verification status"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={verificationStatus} onChange={event => setVerificationStatus(event.target.value)}><option value="">Any status</option><option value="full">Fully verified</option><option value="provisional">Provisional</option><option value="revoked">Revoked</option></select></Field>
                  <Field label="Feature usage"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={featureKey} onChange={event => setFeatureKey(event.target.value)}><option value="">Any feature</option>{featureOptions.map(feature => <option key={feature} value={feature}>{feature.replaceAll('_', ' ')}</option>)}</select></Field>
                  <Field label="Active since"><Input type="date" value={lastActiveAfter} onChange={event => setLastActiveAfter(event.target.value)} /></Field>
                </div>
              )}

              <Field label="Subject line"><Input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Field label="Email Body">
                  <Textarea className="min-h-64 font-mono text-sm" value={body} maxLength={20000} onChange={event => setBody(event.target.value)} />
                </Field>
                <Field label="Body format">
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bodyFormat} onChange={event => setBodyFormat(event.target.value as BodyFormat)}><option value="markdown">Markdown</option><option value="html">Safe HTML</option></select>
                  <p className="mt-2 text-xs leading-5 text-ink-muted">{bodyFormat === 'markdown' ? 'Use ## headings, **bold**, and - lists.' : 'Scripts, event handlers, and unsafe URLs are removed.'}</p>
                </Field>
              </div>
              <Field label="Send later (optional)"><Input type="datetime-local" value={scheduledAt} min={new Date().toISOString().slice(0, 16)} onChange={event => setScheduledAt(event.target.value)} /></Field>

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button type="button" variant="outline" onClick={() => void requestPreview()} disabled={previewLoading}>{previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Preview</Button>
                <Button type="button" variant="outline" onClick={sendTest} disabled={sendBusy !== null || !subject.trim() || !body.trim()}>{sendBusy === 'test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send Test to Me</Button>
                <Button type="button" onClick={sendBroadcast} disabled={sendBusy !== null || !previewed || recipientCount === null || recipientCount < 1}>{sendBusy === 'broadcast' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{scheduledAt ? 'Schedule Broadcast' : 'Send Broadcast'}</Button>
              </div>
            </div>

            <div className="min-h-[640px] overflow-hidden rounded-card border border-border bg-card">
              <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-ink">Live Preview</h2><p className="text-xs text-ink-muted">The final unsubscribe link is unique to each recipient.</p></div>
              {previewHtml ? <iframe title="Broadcast email preview" sandbox="" srcDoc={previewHtml} className="h-[760px] w-full bg-white" /> : <div className="flex min-h-[560px] items-center justify-center p-8 text-center text-sm text-ink-muted">Start composing to render the branded email preview.</div>}
            </div>
          </section>

          <section className="rounded-card border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><BellRing className="h-5 w-5" /></div><div><h2 className="text-lg font-semibold text-ink">Push Notifications</h2><p className="text-sm text-ink-muted">Send to active PWA subscriptions in the same selected segment. Email unsubscribe status does not change push consent.</p></div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.5fr_1fr_auto] lg:items-end">
              <Field label="Push title"><Input value={pushTitle} maxLength={100} onChange={event => setPushTitle(event.target.value)} /></Field>
              <Field label="Push body"><Input value={pushBody} maxLength={240} onChange={event => setPushBody(event.target.value)} /></Field>
              <Field label="Click-through path"><Input value={pushHref} maxLength={500} onChange={event => setPushHref(event.target.value)} placeholder="/dashboard" /></Field>
              <Button type="button" onClick={sendPush} disabled={pushBusy || pushCount === null || pushCount < 1 || !pushTitle.trim() || !pushBody.trim()}>{pushBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send Push</Button>
            </div>
            <p className="mt-3 text-sm font-medium text-ink-muted">{pushCountLoading ? 'Counting active push subscribers…' : pushCount === null ? 'Choose a complete audience to count push subscribers.' : `This will send to ${pushCount} subscribed user${pushCount === 1 ? '' : 's'}.`}</p>
          </section>
        </TabsContent>

        <TabsContent value="templates">
          <section className="grid gap-4 md:grid-cols-2">
            {Object.entries(BROADCAST_TEMPLATE_COPY).map(([key, value]) => <button key={key} type="button" onClick={() => applyTemplate(key as BroadcastTemplate)} className="rounded-card border border-border bg-card p-6 text-left transition hover:border-primary/50"><span className="text-xs font-semibold uppercase tracking-wide text-primary">{value.label}</span><h2 className="mt-2 text-lg font-semibold text-ink">{value.subject || 'Blank custom message'}</h2><p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-6 text-ink-muted">{value.body}</p><span className="mt-5 inline-block text-sm font-semibold text-primary">Load template →</span></button>)}
          </section>
        </TabsContent>

        <TabsContent value="history">
          <section className="rounded-card border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold text-ink">Broadcast history</h2><p className="text-sm text-ink-muted">Sent, delivered, and failed counts update from Resend webhooks.</p></div><Button variant="outline" size="sm" onClick={loadHistory}>Refresh</Button></div>
            {historyLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : history.length === 0 ? <p className="p-8 text-sm text-ink-muted">No broadcasts yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-5 py-3">Subject</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Recipients</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Delivered</th><th className="px-4 py-3">Failed</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{history.map(item => <tr key={item.id} onClick={() => void loadDetail(item.id)} className="cursor-pointer border-t border-border hover:bg-surface"><td className="px-5 py-4 font-semibold text-ink">{item.subject}</td><td className="px-4 py-4 text-ink-muted">{new Date(item.created_at).toLocaleString()}</td><td className="px-4 py-4">{item.recipient_count}</td><td className="px-4 py-4">{item.sent_count}</td><td className="px-4 py-4 text-emerald-700">{item.delivered_count}</td><td className="px-4 py-4 text-red-700">{item.failed_count}</td><td className="px-4 py-4"><Status value={item.status} /></td></tr>)}</tbody></table></div>}
          </section>
          {detail && <section className="mt-6 rounded-card border border-border bg-card"><div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold text-ink">{detail.broadcast.subject}</h2><p className="text-sm text-ink-muted">Per-recipient delivery status</p></div><Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close</Button></div><div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead className="sticky top-0 bg-surface text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-5 py-3">Recipient</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Provider event</th></tr></thead><tbody>{detail.recipients.map(recipient => <tr key={recipient.id} className="border-t border-border"><td className="px-5 py-3 font-medium text-ink">{recipient.display_name || 'StocMed user'}</td><td className="px-4 py-3 text-ink-muted">{recipient.recipient_email}</td><td className="px-4 py-3"><Status value={recipient.delivery_status} /></td><td className="px-4 py-3 text-xs text-ink-muted">{recipient.last_error || recipient.provider_status || 'Waiting'}</td></tr>)}</tbody></table></div></section>}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AudienceCount(props: { loading: boolean; count: number | null; empty: boolean; error: string }) {
  if (props.empty) return <p className="mt-2 text-xs text-ink-muted">Complete this audience to calculate recipients.</p>
  if (props.loading) return <p className="mt-2 text-xs text-ink-muted">Calculating live count…</p>
  if (props.error) return <p className="mt-2 text-xs text-danger">{props.error}</p>
  return <p className="mt-2 text-sm font-semibold text-ink">This will send to {props.count ?? 0} user{props.count === 1 ? '' : 's'}.</p>
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
