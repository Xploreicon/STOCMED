import { describe, expect, it, vi } from 'vitest'
import {
  consumeAssistantResponse,
  parseAssistantSseChunk,
} from '@/lib/chat-stream'

describe('assistant SSE transport', () => {
  it('keeps incomplete frames and parses complete deltas', () => {
    const parsed = parseAssistantSseChunk(
      'data: {"type":"delta","text":"I found "}\n\ndata: {"type":"delta"'
    )

    expect(parsed.events).toEqual([{ type: 'delta', text: 'I found ' }])
    expect(parsed.remainder).toBe('data: {"type":"delta"')
  })

  it('renders streamed deltas in order', async () => {
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"delta","text":"Vitamin C "}\n\n')
          )
          controller.enqueue(
            encoder.encode('data: {"type":"delta","text":"found."}\n\n')
          )
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
    const onDelta = vi.fn()

    await expect(consumeAssistantResponse(response, onDelta)).resolves.toBe(
      'Vitamin C found.'
    )
    expect(onDelta.mock.calls.flat()).toEqual(['Vitamin C ', 'found.'])
  })

  it('returns a useful streamed provider error when no text was emitted', async () => {
    const response = new Response(
      'data: {"type":"error","message":"Assistant credit is unavailable.","reason":"credit"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }
    )

    await expect(consumeAssistantResponse(response, vi.fn())).resolves.toBe(
      'Assistant credit is unavailable.'
    )
  })
})
