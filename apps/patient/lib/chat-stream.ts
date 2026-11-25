export type AssistantStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; model?: string }
  | { type: 'error'; message: string; reason?: string }

export function parseAssistantSseChunk(buffer: string): {
  events: AssistantStreamEvent[]
  remainder: string
} {
  const frames = buffer.split('\n\n')
  const remainder = frames.pop() ?? ''
  const events: AssistantStreamEvent[] = []

  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')

    if (!data) continue

    try {
      const parsed = JSON.parse(data) as AssistantStreamEvent
      if (parsed && typeof parsed.type === 'string') events.push(parsed)
    } catch {
      // Ignore malformed transport frames; the next complete event can still render.
    }
  }

  return { events, remainder }
}

export async function consumeAssistantResponse(
  response: Response,
  onDelta: (text: string) => void
): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = (await response.json()) as { message?: unknown }
    return typeof payload.message === 'string' ? payload.message : null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let errorMessage: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const parsed = parseAssistantSseChunk(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      if (event.type === 'delta') {
        text += event.text
        onDelta(event.text)
      } else if (event.type === 'error') {
        errorMessage = event.message
      }
    }

    if (done) break
  }

  return text || errorMessage
}
