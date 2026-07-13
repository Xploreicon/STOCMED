import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  client ??= new Anthropic({ apiKey })
  return client
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = 'status' in error ? error.status : null
  return typeof status === 'number' ? status : null
}

export async function runClaudeRequest<T>(
  request: () => Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Anthropic request timed out')),
          timeoutMs
        )
      })
      return await Promise.race([request(), timeoutPromise])
    } catch (error) {
      const status = errorStatus(error)
      const isTransient = status === 500 || status === 502 || status === 503 || status === 529

      // Credit/rate-limit errors are not retried, preventing duplicate spend pressure.
      if (!isTransient || attempt === 1) return null
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  return null
}
