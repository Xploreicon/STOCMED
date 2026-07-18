import { NextRequest, NextResponse } from 'next/server'
import {
  ClaudeRequestError,
  DEFAULT_CLAUDE_MODEL,
  getAnthropicClient,
  reportClaudeFailure,
  toClaudeRequestError,
  toClaudeEmptyResponseError,
} from '@/lib/anthropic'
import { triageQuery } from '@/lib/triage/classifier'
import { getSafeResponse } from '@/lib/triage/safe-responses'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/observability'
import { z } from 'zod'

const ASSISTANT_MODEL =
  process.env.ANTHROPIC_ASSISTANT_MODEL || DEFAULT_CLAUDE_MODEL

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(2000),
})

const assistantPayloadSchema = z.object({
  conversation: z.array(chatMessageSchema),
  query: z.string().max(1000).optional().default(''),
  userLocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      label: z.string(),
    })
    .nullable()
    .optional(),
  searchLocation: z.string().trim().max(200).nullable().optional(),
  pharmacies: z.array(z.record(z.string(), z.any())).optional(),
})


const streamHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

function staticAssistantResponse(message: string, model?: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encodeEvent({ type: 'delta', text: message }))
        controller.enqueue(encodeEvent({ type: 'done', model }))
        controller.close()
      },
    }),
    { headers: streamHeaders }
  )
}

// Scope-locked clinical-concierge prompt (C.1)
const SYSTEM_PROMPT = `You are StocMed's scope-locked patient concierge.

CRITICAL MEDICAL COMPLIANCE RULES:
1. NEVER diagnose the user's condition. If they ask "do I have malaria?" or describe symptoms, refer them to a doctor.
2. NEVER prescribe or recommend medication. If they ask "what should I take for headache?", list categories of information (e.g. Analgesics) but DO NOT recommend a specific drug.
3. NEVER provide dosage instructions or medical treatment suggestions. Refer to the product packaging or a pharmacist.
4. ONLY help locate named medications in our registered pharmacy database, check pricing, and answer basic factual queries about the drugs (manufacturer, pack size) using PROVIDED CONTEXT.
5. If the drug is a Prescription-Only Medication (POM), explicitly remind the user: "This medication requires a valid prescription to purchase. You can still view pharmacy availability and pricing; a verified licensed pharmacist must pre-review any digital hold, and the destination pharmacy makes the final dispensing decision."
6. Refuse to answer queries outside the scope of medication search, pharmacy directory, or basic drug information.

Tone & Style:
- Warm, concise, direct, and plain-language. Use at most 3 short sentences.
- Never introduce yourself, greet, restate your capabilities, or show a capability menu. The application handles the one-time greeting.
- Answer the current request immediately. Do not add generic offers to help.
- When the application has already sent a REQUIRED RESULT LEAD, return exactly this sentence and nothing else: "Check the result card below for pharmacy details."
- When no match exists, say that directly and suggest checking the spelling or asking a pharmacist about an equivalent product.
- Markdown is allowed only when it improves readability; never output a capability list.`

const GREETING_REGEX =
  /^(hi|hello|hey|hiya|good morning|good afternoon|good evening)(?:[!\.\s]*)$/i

function assistantFailureMessage(error: ClaudeRequestError): string {
  switch (error.kind) {
    case 'auth':
      return 'The assistant service needs an account configuration update. Medication search is still available while it is restored.'
    case 'credit':
      return 'The assistant is temporarily unavailable while its service credit is restored. Medication search is still available.'
    case 'rate_limit': {
      const wait = error.retryAfterSeconds
        ? ` Please wait ${error.retryAfterSeconds} seconds and try again.`
        : ' Please wait a moment and try again.'
      return `The assistant is receiving too many requests.${wait} Medication search is still available.`
    }
    case 'model_access':
      return 'The assistant model is temporarily unavailable for this service account. Medication search is still available.'
    case 'timeout':
    case 'transient':
      return 'The assistant service is temporarily unavailable. Please try again in a moment; medication search is still available.'
    case 'invalid_request':
      return 'The assistant could not process this request. Please shorten the message or start a new chat.'
    default:
      return 'The assistant could not complete this request. Medication search is still available while the issue is investigated.'
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'chat-assistant', 15, 60_000)
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response
  }

  try {
    const rawJson = await request.json()
    const parsed = assistantPayloadSchema.safeParse(rawJson)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload schema', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { conversation, query, userLocation, searchLocation, pharmacies } = parsed.data


    const lastUserMessage =
      [...conversation].filter((msg) => msg.role === 'user').pop()?.content || ''

    // Fast-track greetings
    if (
      GREETING_REGEX.test(lastUserMessage.trim()) &&
      (!query || !query.trim())
    ) {
      return staticAssistantResponse('Hi! What medication are you looking for today?')
    }

    // 1. Server-Side Triage Gating (C.2)
    const triageResult = await triageQuery(query || lastUserMessage);

    // If tier is restricted, crisis, or emergency, bypass LLM entirely
    if (
      triageResult.risk_tier === 'CRISIS' ||
      triageResult.risk_tier === 'BLOCK_SOURCING' ||
      triageResult.risk_tier === 'CARE_REDIRECT' ||
      triageResult.risk_tier === 'REDIRECT'
    ) {
      const symptomIntakeEnabled =
        process.env.STAFFED_SAFETY_FLOWS_ENABLED === 'true'
        && process.env.SYMPTOM_INTAKE_ENABLED === 'true'
      const safeResponse = getSafeResponse(
        triageResult.intent,
        triageResult.risk_tier,
        { symptomIntakeEnabled }
      );
      return staticAssistantResponse(safeResponse.message)
    }

    // 2. Prepare Context for ALLOW / GATE queries
    const contextLines: string[] = [
      `Query: ${query}`,
      `Triage Tier: ${triageResult.risk_tier}`,
      `Triage Intent: ${triageResult.intent}`,
      userLocation
        ? `User location: ${userLocation.label} (${userLocation.latitude}, ${userLocation.longitude})`
        : searchLocation
          ? `User location: ${searchLocation}`
          : 'User location: not provided',
    ]
    let requiredResultLead: string | null = null

    // POM availability and pricing remain visible. The prescription gate applies
    // to purchase and destination-pharmacy digital reservation, not discovery.
    if (triageResult.risk_tier === 'GATE') {
      contextLines.push('POM NOTICE: Pharmacy availability and pricing are visible. A valid prescription is required to purchase. A verified licensed pharmacist must pre-review a digital hold; final dispensing remains with the selected destination pharmacy.');
    }

    const isMedicationSearch =
      triageResult.risk_tier === 'ALLOW' || triageResult.risk_tier === 'GATE'

    if (pharmacies && pharmacies.length > 0 && isMedicationSearch) {
      const formatCurrency = (value: number | null | undefined) =>
        typeof value === 'number' && !Number.isNaN(value)
          ? `₦${value.toLocaleString()}`
          : null

      const distinctPharmacies = new Set(
        pharmacies.map((item: Record<string, any>, index: number) => {
          const pharmacy = (item.pharmacies || {}) as Record<string, any>
          return pharmacy.id || item.pharmacy_id || pharmacy.pharmacy_name || `result-${index}`
        })
      ).size
      const prices = pharmacies
        .map((item: Record<string, any>) => item.price)
        .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))
      const minimumPrice = prices.length ? Math.min(...prices) : null
      const firstResult = pharmacies[0] as Record<string, any>
      const medicationName =
        firstResult.generic_name || firstResult.name || firstResult.brand_name || query
      const pharmacyWord = distinctPharmacies === 1 ? 'pharmacy' : 'pharmacies'
      const locationPhrase = searchLocation || userLocation?.label ? ' near you' : ''
      const pricePhrase = minimumPrice === null ? '' : `, from ${formatCurrency(minimumPrice)}`
      requiredResultLead = `I found ${medicationName} at ${distinctPharmacies} ${pharmacyWord}${locationPhrase}${pricePhrase}.`
      if (triageResult.risk_tier === 'GATE') {
        requiredResultLead += ' A valid prescription is required to purchase or reserve it digitally.'
      }

      contextLines.push(
        'RESULT CARD: available. The application already sent the exact medication, count, location, and price. Return exactly: "Check the result card below for pharmacy details."'
      )
    } else {
      contextLines.push('Nearby pharmacies: none supplied')
    }

    if (
      isMedicationSearch &&
      (!pharmacies || pharmacies.length === 0)
    ) {
      const locationPhrase = searchLocation ? ` in ${searchLocation}` : ''
      return staticAssistantResponse(
        `I couldn't find ${query || 'that medication'}${locationPhrase} right now. Check the spelling or ask a pharmacist about an equivalent product.`
      )
    }

    // Filter and map conversation messages to match Anthropic message format
    const messages = conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }))

    // React state may not yet contain the just-submitted turn. Never omit the active query.
    if (
      query.trim() &&
      (messages.at(-1)?.role !== 'user' || messages.at(-1)?.content.trim() !== query.trim())
    ) {
      messages.push({ role: 'user', content: query.trim() })
    }

    const anthropic = getAnthropicClient()
    if (!anthropic) {
      const configurationError = new Error('ANTHROPIC_API_KEY is not configured')
      console.error('[anthropic.configuration_error]', configurationError.message)
      logger.error('anthropic_configuration_error', configurationError, {
        model: ASSISTANT_MODEL,
        operation: 'assistant',
      })
      return staticAssistantResponse(
        'The assistant service needs an account configuration update. Medication search is still available while it is restored.'
      )
    }

    return new Response(
      new ReadableStream({
        async start(controller) {
          let receivedText = false
          let responseId = 'stream'
          let responseModel = ASSISTANT_MODEL
          let stopReason: string | null = null

          try {
            if (requiredResultLead) {
              controller.enqueue(
                encodeEvent({ type: 'delta', text: `${requiredResultLead} ` })
              )
            }

            const stream = anthropic.messages.stream(
              {
                model: ASSISTANT_MODEL,
                max_tokens: 60,
                temperature: 0,
                system: SYSTEM_PROMPT + '\n\n' + contextLines.join('\n'),
                messages,
              },
              { timeout: 10_000, maxRetries: 1 }
            )

            for await (const event of stream) {
              if (event.type === 'message_start') {
                responseId = event.message.id
                responseModel = event.message.model
              } else if (event.type === 'message_delta') {
                stopReason = event.delta.stop_reason
              } else if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
              ) {
                receivedText = true
                controller.enqueue(encodeEvent({ type: 'delta', text: event.delta.text }))
              }
            }

            if (!receivedText) {
              throw toClaudeEmptyResponseError(
                { model: ASSISTANT_MODEL, operation: 'assistant' },
                {
                  id: responseId,
                  model: responseModel,
                  stopReason,
                  contentTypes: [],
                }
              )
            }

            controller.enqueue(encodeEvent({ type: 'done', model: responseModel }))
          } catch (error: unknown) {
            const claudeError = toClaudeRequestError(error, {
              model: ASSISTANT_MODEL,
              operation: 'assistant',
            })
            reportClaudeFailure(claudeError)
            controller.enqueue(
              encodeEvent({
                type: 'error',
                message: assistantFailureMessage(claudeError),
                reason: claudeError.kind,
              })
            )
          } finally {
            controller.close()
          }
        },
      }),
      { headers: streamHeaders }
    )
  } catch (error: unknown) {
    if (error instanceof ClaudeRequestError) {
      return NextResponse.json({
        message: assistantFailureMessage(error),
        assistant_status: {
          available: false,
          reason: error.kind,
          retry_after_seconds: error.retryAfterSeconds,
        },
      })
    }

    const routeError = error instanceof Error ? error : new Error(String(error))
    console.error('[assistant.route_error]', routeError)
    logger.error('assistant_route_error', routeError, {
      model: ASSISTANT_MODEL,
      operation: 'assistant',
    })
    return NextResponse.json(
      {
        message:
          'The assistant could not complete this request. Medication search is still available while the issue is investigated.',
        assistant_status: { available: false, reason: 'unknown' },
      },
      { status: 200 }
    )
  }
}
