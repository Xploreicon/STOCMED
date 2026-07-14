import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/observability'
import {
  ClaudeRequestError,
  toClaudeRequestError,
  type ClaudeRequestMetadata,
} from '@/lib/anthropic-errors'

export {
  ClaudeRequestError,
  toClaudeEmptyResponseError,
  toClaudeRequestError,
  type ClaudeFailureKind,
} from '@/lib/anthropic-errors'

let client: Anthropic | null = null

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

class ClaudeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Anthropic request timed out after ${timeoutMs}ms`)
    this.name = 'ClaudeTimeoutError'
  }
}

export function reportClaudeFailure(error: ClaudeRequestError): void {
  const details = {
    status: error.status,
    error_type: error.providerType,
    message: error.providerMessage,
    body: error.providerBody,
    request_id: error.requestId,
    failure_kind: error.kind,
    model: error.model,
    operation: error.operation,
  }

  // Provider diagnostics are intentionally server-only and never include prompts.
  console.error('[anthropic.request_failed]', JSON.stringify(details))
  logger.error('anthropic_request_failed', error, {
    status: error.status,
    provider_type: error.providerType,
    failure_kind: error.kind,
    model: error.model,
    operation: error.operation,
    request_id: error.requestId,
  })
}

export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  client ??= new Anthropic({ apiKey })
  return client
}

export async function runClaudeRequest<T>(
  request: () => Promise<T>,
  timeoutMs: number,
  metadata: ClaudeRequestMetadata
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ClaudeTimeoutError(timeoutMs)), timeoutMs)
      })
      return await Promise.race([request(), timeoutPromise])
    } catch (error) {
      const claudeError = toClaudeRequestError(error, metadata)
      const shouldRetry = claudeError.kind === 'transient' && attempt === 0

      if (!shouldRetry) {
        reportClaudeFailure(claudeError)
        throw claudeError
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  throw new Error('Anthropic retry loop exited unexpectedly')
}
