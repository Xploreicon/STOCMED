import { NextRequest, NextResponse } from 'next/server'

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

const SYSTEM_PROMPT = `You are StocMed's friendly pharmacy concierge.

Tone & style:
- Warm, professional, and conversational. Use emojis sparingly (at most one per paragraph) to add warmth.
- Keep responses concise: no more than 3–4 sentences total.
- Format pharmacy options as clear bullet points with bold pharmacy names, medication details, price (use the ₦ symbol), stock, and distance.
- Always close with a helpful nudge or question that keeps the conversation moving.

Safety:
- NEVER prescribe, recommend dosages, or claim medical authority.
- Always remind users to follow their doctor's advice or speak with a licensed pharmacist for medical questions.
- If information is missing, ask follow-up questions (e.g., strength, preferred brand, location).
- If there are no results, offer concrete next steps so the user is never stuck.

Knowledge base:
- Rely solely on the provided context for pharmacy and product data—do not invent or assume availability beyond what you see.`

const GREETING_REGEX =
  /^(hi|hello|hey|hiya|good morning|good afternoon|good evening)(?:[!\.\s]*)$/i

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY

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

    if (
      GREETING_REGEX.test(lastUserMessage.trim()) &&
      (!query || !query.trim())
    ) {
      return NextResponse.json({
        message: 'Hi! What medication are you looking for today?',
      })
    }

    const contextLines: string[] = [
      `Query: ${query}`,
      userLocation
        ? `User location: ${userLocation.label} (${userLocation.latitude}, ${userLocation.longitude})`
        : 'User location: not provided',
    ]

    if (pharmacies && pharmacies.length > 0) {
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
    } else {
      contextLines.push('Nearby pharmacies: none supplied')
    }

    const contextMessage: ChatMessage = {
      role: 'system',
      content: contextLines.join('\n'),
    }

    const payload = {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        contextMessage,
        ...conversation,
      ],
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Assistant API error:', response.status, errorText)
      return NextResponse.json(
        {
          message:
            'The assistant service is currently unreachable. Please try again shortly.',
        },
        { status: 200 }
      )
    }

    const completion = await response.json()
    const assistantMessage =
      completion?.choices?.[0]?.message?.content ??
      'I am unable to provide additional details right now.'

    return NextResponse.json({ message: assistantMessage })
  } catch (error) {
    console.error('Assistant route error:', error)
    return NextResponse.json(
      {
        message:
          'I ran into an unexpected error while contacting the assistant service.',
      },
      { status: 200 }
    )
  }
}
