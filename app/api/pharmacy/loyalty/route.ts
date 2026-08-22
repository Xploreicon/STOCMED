import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensurePharmacyRecord } from '@/lib/pharmacy'
import { requirePharmacyFeature } from '@/lib/pharmacy-features'

async function context(){
  const supabase=(await createClient()) as any
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return null
  const pharmacy=await ensurePharmacyRecord(supabase,user)
  return pharmacy?{supabase,pharmacy}:null
}

export async function GET(request:NextRequest){
  const current=await context()
  if(!current)return NextResponse.json({error:'Unauthorized'},{status:401})
  const featureError=await requirePharmacyFeature(current.supabase,current.pharmacy.id,'loyalty')
  if(featureError)return NextResponse.json(featureError,{status:403})
  const customerId=request.nextUrl.searchParams.get('customer_id')
  if(customerId){
    if(!z.string().uuid().safeParse(customerId).success)return NextResponse.json({error:'Choose a valid customer'},{status:400})
    const {data,error}=await current.supabase.rpc('get_customer_loyalty',{p_customer_id:customerId})
    return error?NextResponse.json({error:error.message},{status:409}):NextResponse.json({loyalty:data})
  }
  const to=request.nextUrl.searchParams.get('to')||new Date().toISOString().slice(0,10)
  const from=request.nextUrl.searchParams.get('from')||new Date(Date.now()-29*86_400_000).toISOString().slice(0,10)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return NextResponse.json({error:'Invalid date range'},{status:400})
  const {data,error}=await current.supabase.rpc('get_loyalty_report',{p_from:from,p_to:to})
  return error?NextResponse.json({error:error.message},{status:409}):NextResponse.json({report:data})
}

export async function PUT(request:NextRequest){
  const parsed=z.object({points_per_naira:z.coerce.number().min(0).max(10),redemption_naira_per_point:z.coerce.number().positive().max(10000),minimum_redemption_points:z.coerce.number().int().min(1).max(1000000)}).safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Check the loyalty settings'},{status:400})
  const current=await context()
  if(!current)return NextResponse.json({error:'Unauthorized'},{status:401})
  const featureError=await requirePharmacyFeature(current.supabase,current.pharmacy.id,'loyalty')
  if(featureError)return NextResponse.json(featureError,{status:403})
  const {data,error}=await current.supabase.rpc('set_loyalty_config',{p_points_per_naira:parsed.data.points_per_naira,p_redemption_naira_per_point:parsed.data.redemption_naira_per_point,p_minimum_redemption_points:parsed.data.minimum_redemption_points})
  return error?NextResponse.json({error:error.message},{status:409}):NextResponse.json(data)
}
