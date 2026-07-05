import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { triageQuery } from '@/lib/triage/classifier'
import { getSafeResponse } from '@/lib/triage/safe-responses'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface AssistantPayload {
  conversation: ChatMessage[]
  query: string
  userLocation?: {
    latitude: number
    longitude: number
    label: string
  } | null
  pharmacies?: Array<Record<string, any>>
}

// Scope-locked clinical-concierge prompt (C.1)
const SYSTEM_PROMPT = `You are StocMed's scope-locked patient concierge.

CRITICAL MEDICAL COMPLIANCE RULES:
1. NEVER diagnose the user's condition. If they ask "do I have malaria?" or describe symptoms, refer them to a doctor.
2. NEVER prescribe or recommend medication. If they ask "what should I take for headache?", list categories of information (e.g. Analgesics) but DO NOT recommend a specific drug.
3. NEVER provide dosage instructions or medical treatment suggestions. Refer to the product packaging or a pharmacist.
4. ONLY help locate named medications in our registered pharmacy database, check pricing, and answer basic factual queries about the drugs (manufacturer, pack size) using PROVIDED CONTEXT.
5. If the drug is a Prescription-Only Medication (POM), explicitly remind the user: "This medication requires a valid prescription to purchase or view pricing/locations."
6. Refuse to answer queries outside the scope of medication search, pharmacy directory, or basic drug information.

Tone & Style:
- Professional, concise, supportive, and plain-language (clear for low-literacy users).
- Max 3 sentences. No fluff.
- Format pharmacy lists as clean bullet points: bold pharmacy name, price (₦ symbol), stock availability, and distance.`

const GREETING_REGEX =
  /^(hi|hello|hey|hiya|good morning|good afternoon|good evening)(?:[!\.\s]*)$/i

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        {
          message:
            'I am unable to reach the assistant service right now, but I can still help with basic search results.',
        },
        { status: 200 }
      )
    }

    const body = (await request.json()) as AssistantPayload
    const { conversation, query, userLocation, pharmacies } = body

    const lastUserMessage =
      [...conversation].filter((msg) => msg.role === 'user').pop()?.content || ''

    // Fast-track greetings
    if (
      GREETING_REGEX.test(lastUserMessage.trim()) &&
      (!query || !query.trim())
    ) {
      return NextResponse.json({
        message: 'Hi! What medication are you looking for today?',
        triage: { intent: 'OUT_OF_SCOPE', risk_tier: 'ALLOW' }
      })
    }

    // 1. Server-Side Triage Gating (C.2)
    const triageResult = await triageQuery(query || lastUserMessage);

    // If tier is restricted, crisis, or emergency, bypass LLM entirely
    if (
      triageResult.risk_tier === 'CRISIS' ||
      triageResult.risk_tier === 'BLOCK_SOURCING' ||
      triageResult.risk_tier === 'REDIRECT'
    ) {
      const safeResponse = getSafeResponse(triageResult.intent, triageResult.risk_tier);
      return NextResponse.json({
        message: safeResponse.message,
        triage: triageResult
      });
    }

    // 2. Prepare Context for ALLOW / GATE queries
    const contextLines: string[] = [
      `Query: ${query}`,
      `Triage Tier: ${triageResult.risk_tier}`,
      `Triage Intent: ${triageResult.intent}`,
      userLocation
        ? `User location: ${userLocation.label} (${userLocation.latitude}, ${userLocation.longitude})`
        : 'User location: not provided',
    ]

    // If GATE (POM) is active, indicate prescription restriction
    if (triageResult.risk_tier === 'GATE') {
      contextLines.push('RESTRICTION: This is a Prescription-Only Medication (POM). Do not list pharmacy details or prices until prescription is uploaded.');
    }

    if (pharmacies && pharmacies.length > 0 && triageResult.risk_tier === 'ALLOW') {
      const formatCurrency = (value: number | null | undefined) =>
        typeof value === 'number' && !Number.isNaN(value)
          ? `₦${value.toLocaleString()}`
          : null

      const describeStock = (
        quantity: number | null | undefined,
        threshold?: number | null
      ) => {
        if (quantity === null || quantity === undefined) return 'Stock unknown'
        if (quantity <= 0) return 'Out of stock'
        if (threshold && quantity <= threshold)
          return `Low stock (${quantity} remaining)`
        return `In stock (${quantity} available)`
      }

      const topPharmacies = pharmacies
        .slice(0, 5)
        .map((item, index) => {
          const pharmacy = item.pharmacies ?? {}
          const distance =
            typeof item.distance_km === 'number'
              ? `${item.distance_km.toFixed(1)} km`
              : 'n/a'
          const priceRange =
            typeof item.price_range_min === 'number' &&
            typeof item.price_range_max === 'number'
              ? `${formatCurrency(item.price_range_min)} – ${formatCurrency(
                  item.price_range_max
                )}`
              : formatCurrency(item.price) ?? 'Price unavailable'
          const medicationName =
            item.name || item.brand_name || item.generic_name || 'Medication'
          const strength = item.strength ? ` (${item.strength})` : ''
          const stockText = describeStock(
            item.quantity_in_stock ?? null,
            item.low_stock_threshold
          )
          return `- Pharmacy ${index + 1}: ${pharmacy.pharmacy_name || 'Unknown pharmacy'} | Product: ${medicationName}${strength} | Price: ${priceRange} | ${stockText} | Distance: ${distance}`
        })
        .join('\n')

      contextLines.push(
        `Nearby pharmacies:\n${topPharmacies || 'No pharmacies available'}`
      )
    } else if (triageResult.risk_tier === 'GATE') {
      contextLines.push('Nearby pharmacies: hidden (requires prescription verification)')
    } else {
      contextLines.push('Nearby pharmacies: none supplied')
    }

    // Filter and map conversation messages to match Anthropic message format
    const messages = conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }))

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: apiKey,
    })

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0.2,
      system: SYSTEM_PROMPT + '\n\n' + contextLines.join('\n'),
      messages: messages,
    })

    const assistantMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : 'I am unable to provide additional details right now.'

    return NextResponse.json({
      message: assistantMessage,
      triage: triageResult
    })
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? 'unknown'
    const errorMessage = error?.message ?? String(error)
    console.error(`Assistant route error [${status}]:`, errorMessage)
    return NextResponse.json(
      {
        message:
          'I ran into an unexpected error while contacting the assistant service.',
      },
      { status: 200 }
    )
  }
}
