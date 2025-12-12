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

const SYSTEM_PROMPT = `You are StocMed's pharmacy assistant. Your role is to help users find medications at nearby pharmacies.

Core Guidelines:
1. Keep responses concise (max 3-4 sentences). Be friendly and conversational.
2. When results are found, highlight top 2-3 options mentioning: pharmacy name, price, distance, and stock status.
3. Ask clarifying questions if needed (e.g., "Which strength - 500mg or 1000mg?" or "Do you need tablets or syrup?").
4. For general medication questions, provide basic info (common uses, side effects) but ALWAYS remind users to consult their doctor or pharmacist.
5. NEVER diagnose, prescribe doses, or give medical advice. Redirect medical questions to healthcare professionals.
6. For symptom-based queries (e.g., "headache"), suggest common OTC options but emphasize consulting a pharmacist.
7. If medication not found, suggest: checking spelling, trying generic/brand name, or describing symptoms.
8. Use ONLY the pharmacy data provided in context - never invent prices, locations, or stock levels.

Response Format:
- Start with a brief, helpful sentence
- If results exist, mention top 1-2 pharmacies with key details
- End with a follow-up question or helpful next step
- Keep total response under 4 sentences unless explaining medication safety info

Example responses:
"I found Paracetamol 500mg at 3 nearby pharmacies. HealthPlus on Admiralty Way has it for ₦1,200 (15 in stock, 0.5km away). MedExpress is slightly farther at 1.2km for ₦1,500. Would you like directions to either?"

"I couldn't find that exact medication. Could you try the generic name or let me know what symptoms you're treating? A pharmacist can also help identify the right option."`

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

    const contextLines: string[] = [
      `Query: ${query}`,
      userLocation
        ? `User location: ${userLocation.label} (${userLocation.latitude}, ${userLocation.longitude})`
        : 'User location: not provided',
    ]

    if (pharmacies && pharmacies.length > 0) {
      const topPharmacies = pharmacies
        .slice(0, 5)
        .map((item, index) => {
          const pharmacy = item.pharmacies ?? {}
          const distance =
            typeof item.distance_km === 'number'
              ? `${item.distance_km}km`
              : 'distance unknown'
          const priceRange =
            typeof item.price_range_min === 'number' &&
            typeof item.price_range_max === 'number'
              ? `₦${item.price_range_min.toLocaleString()} - ₦${item.price_range_max.toLocaleString()}`
              : item.price
              ? `₦${Number(item.price).toLocaleString()}`
              : 'price not listed'
          const stockInfo =
            typeof item.quantity_in_stock === 'number'
              ? `${item.quantity_in_stock} in stock`
              : 'stock unknown'
          const drugName = item.name || item.brand_name || item.generic_name || 'medication'
          const strength = item.strength ? ` ${item.strength}` : ''
          const form = item.dosage_form ? ` (${item.dosage_form})` : ''

          return `${index + 1}. ${drugName}${strength}${form} at ${pharmacy.pharmacy_name || 'Unknown pharmacy'} - ${priceRange}, ${stockInfo}, ${distance} away${pharmacy.city ? ` in ${pharmacy.city}` : ''}`
        })
        .join('\n')

      contextLines.push(
        `Available options (${pharmacies.length} total):\n${topPharmacies}`
      )
    } else {
      contextLines.push('No matching medications found in nearby pharmacies.')
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
