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

const SYSTEM_PROMPT = `You are StocMed's pharmacy concierge.

Primary responsibilities:
- Help users locate medications near them and suggest the best pharmacy from the provided context.
- Highlight stock status, price range, and distance that are already calculated in the context.
- Offer prudent, general medication education (uses, precautions, side effects) based solely on widely accepted information. Do not invent specifics beyond your training.
- Always encourage users to follow their prescriber's directions and to consult a licensed pharmacist or doctor for anything medical.
- Offer to connect the user with a pharmacist or provide pickup/confirmation steps when appropriate.

Safety rails:
- If the user strays outside medication discovery, pharmacy logistics, or basic education, politely refuse and steer them back.
- Never create diagnoses, prescribe doses, or contradict prescribers.
- If a medication is not found, suggest alternative search tips or recommend seeing a pharmacist/doctor.

Response style:
- Conversational, concise sentences (1–3 short paragraphs max).
- Use markdown lists only when summarising multiple options.
- If you mention a pharmacy or medication, rely on the supplied context—never fabricate data.`

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
              ? `${item.distance_km} km`
              : 'n/a'
          const priceRange =
            typeof item.price_range_min === 'number' &&
            typeof item.price_range_max === 'number'
              ? `₦${item.price_range_min?.toLocaleString?.()} – ₦${item.price_range_max?.toLocaleString?.()}`
              : item.price
              ? `₦${Number(item.price).toLocaleString()}`
              : 'Price unavailable'
          return `${index + 1}. ${pharmacy.pharmacy_name || 'Unknown pharmacy'} • ${priceRange} • distance: ${distance} • stock: ${
            item.quantity_in_stock ?? 'n/a'
          }`
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
