'use client'

import { useEffect,useState } from 'react'
import { Gift,Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Report={config:{points_per_naira:number;redemption_naira_per_point:number;minimum_redemption_points:number};summary:{points_issued:number;points_redeemed:number;outstanding:number;redemption_value:number};customers:Array<{customer_id:string;name:string;phone:string|null;balance:number;last_activity:string|null}>}

export default function LoyaltyPage(){
  const [report,setReport]=useState<Report|null>(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [earn,setEarn]=useState('0.01')
  const [value,setValue]=useState('1')
  const [minimum,setMinimum]=useState('100')
  const load=async()=>{setLoading(true);const response=await fetch('/api/pharmacy/loyalty');const body=await response.json().catch(()=>null);if(response.ok){setReport(body.report);setEarn(String(body.report?.config?.points_per_naira??0.01));setValue(String(body.report?.config?.redemption_naira_per_point??1));setMinimum(String(body.report?.config?.minimum_redemption_points??100))}else toast.error(body?.error||'Could not load loyalty');setLoading(false)}
  useEffect(()=>{void load()},[])
  const save=async()=>{setSaving(true);const response=await fetch('/api/pharmacy/loyalty',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({points_per_naira:Number(earn),redemption_naira_per_point:Number(value),minimum_redemption_points:Number(minimum)})});const body=await response.json().catch(()=>null);if(response.ok){toast.success('Loyalty settings saved');await load()}else toast.error(body?.error||'Could not save loyalty settings');setSaving(false)}
  if(loading)return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
  return <div className="mx-auto w-full max-w-6xl pb-12"><header><h1 className="text-3xl font-semibold text-ink">Customer loyalty</h1><p className="mt-2 text-sm text-ink-muted">Reward repeat customers and see the points your pharmacy owes.</p></header>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Points issued" value={report?.summary.points_issued??0}/><Metric label="Points redeemed" value={report?.summary.points_redeemed??0}/><Metric label="Points outstanding" value={report?.summary.outstanding??0}/><Metric label="Discount value used" value={`₦${Number(report?.summary.redemption_value??0).toLocaleString()}`}/></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.4fr]"><section className="rounded-card border border-border bg-card p-5"><div className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary"/><h2 className="font-semibold text-ink">How points work</h2></div><label className="mt-5 block text-sm font-medium text-ink">Points earned per ₦1<Input className="mt-2" type="number" min="0" max="10" step="0.001" value={earn} onChange={event=>setEarn(event.target.value)}/><span className="mt-1 block text-xs font-normal text-ink-muted">0.01 gives 1 point for every ₦100 spent.</span></label><label className="mt-4 block text-sm font-medium text-ink">Naira value of 1 point<Input className="mt-2" type="number" min="0.01" step="0.01" value={value} onChange={event=>setValue(event.target.value)}/></label><label className="mt-4 block text-sm font-medium text-ink">Minimum points to redeem<Input className="mt-2" type="number" min="1" step="1" value={minimum} onChange={event=>setMinimum(event.target.value)}/></label><Button className="mt-5 w-full" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save settings'}</Button></section>
      <section className="overflow-hidden rounded-card border border-border bg-card"><div className="border-b border-border p-4"><h2 className="font-semibold text-ink">Customer balances</h2></div>{!report?.customers.length?<p className="p-10 text-center text-sm text-ink-muted">Customer points will appear after their first qualifying sale.</p>:<div className="divide-y divide-border">{report.customers.map(customer=><div key={customer.customer_id} className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="truncate font-medium text-ink">{customer.name}</p><p className="mt-1 text-xs text-ink-muted">{customer.phone||'No phone number'}</p></div><p className="shrink-0 font-semibold tabular-nums text-primary">{customer.balance.toLocaleString()} pts</p></div>)}</div>}</section></div>
  </div>
}
function Metric({label,value}:{label:string;value:string|number}){return <div className="rounded-card border border-border bg-card p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{typeof value==='number'?value.toLocaleString():value}</p></div>}
