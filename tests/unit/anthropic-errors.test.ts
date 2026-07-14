import { describe, expect, it } from 'vitest'
import {
  toClaudeEmptyResponseError,
  toClaudeRequestError,
} from '@/lib/anthropic-errors'

const metadata = {
  model: 'claude-haiku-4-5-20251001',
  operation: 'assistant' as const,
}

function anthropicError(
  status: number,
  type: string,
  message: string,
  requestId = 'req_test_123'
) {
  return {
    status,
    error: {
      type: 'error',
      error: { type, message },
      request_id: requestId,
    },
  }
}

describe('Anthropic failure diagnostics', () => {
  it('preserves authentication status, type, message, body, and request ID', () => {
    const error = toClaudeRequestError(
      anthropicError(401, 'authentication_error', 'invalid x-api-key'),
      metadata
    )

    expect(error.kind).toBe('auth')
    expect(error.status).toBe(401)
    expect(error.providerType).toBe('authentication_error')
    expect(error.providerMessage).toBe('invalid x-api-key')
    expect(error.providerBody).toContain('invalid x-api-key')
    expect(error.requestId).toBe('req_test_123')
  })

  it('distinguishes exhausted credit from other 400 responses', () => {
    const error = toClaudeRequestError(
      anthropicError(
        400,
        'invalid_request_error',
        'Your credit balance is too low to access the Anthropic API.'
      ),
      metadata
    )

    expect(error.kind).toBe('credit')
  })

  it.each([
    [429, 'rate_limit_error', 'Rate limit exceeded', 'rate_limit'],
    [404, 'not_found_error', 'The requested model was not found', 'model_access'],
    [529, 'overloaded_error', 'Anthropic API is temporarily overloaded', 'transient'],
    [400, 'invalid_request_error', 'messages must not be empty', 'invalid_request'],
  ] as const)('maps HTTP %i to %s', (status, type, message, expectedKind) => {
    const error = toClaudeRequestError(
      anthropicError(status, type, message),
      metadata
    )

    expect(error.kind).toBe(expectedKind)
  })

  it('records a successful Anthropic response with no text as a transient failure', () => {
    const error = toClaudeEmptyResponseError(metadata, {
      id: 'msg_empty_123',
      model: metadata.model,
      stopReason: 'end_turn',
      contentTypes: [],
    })

    expect(error.status).toBe(200)
    expect(error.kind).toBe('transient')
    expect(error.providerType).toBe('empty_response')
    expect(error.providerBody).toContain('"content_count":0')
    expect(error.requestId).toBe('msg_empty_123')
  })
})
