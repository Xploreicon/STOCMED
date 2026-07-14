export type ClaudeFailureKind =
  | 'auth'
  | 'credit'
  | 'rate_limit'
  | 'model_access'
  | 'timeout'
  | 'transient'
  | 'invalid_request'
  | 'unknown'

export interface ClaudeRequestMetadata {
  model: string
  operation: 'assistant' | 'triage'
}

interface ClaudeErrorDetails extends ClaudeRequestMetadata {
  kind: ClaudeFailureKind
  status: number | null
  providerType: string
  providerMessage: string
  providerBody: string
  requestId: string | null
  retryAfterSeconds: number | null
}

export class ClaudeRequestError extends Error {
  readonly kind: ClaudeFailureKind
  readonly status: number | null
  readonly providerType: string
  readonly providerMessage: string
  readonly providerBody: string
  readonly requestId: string | null
  readonly retryAfterSeconds: number | null
  readonly model: string
  readonly operation: ClaudeRequestMetadata['operation']

  constructor(details: ClaudeErrorDetails) {
    super(details.providerMessage)
    this.name = 'ClaudeRequestError'
    this.kind = details.kind
    this.status = details.status
    this.providerType = details.providerType
    this.providerMessage = details.providerMessage
    this.providerBody = details.providerBody
    this.requestId = details.requestId
    this.retryAfterSeconds = details.retryAfterSeconds
    this.model = details.model
    this.operation = details.operation
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function errorStatus(error: Record<string, unknown> | null): number | null {
  const status = error?.status ?? error?.statusCode
  return typeof status === 'number' ? status : null
}

function serializeProviderBody(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '[Anthropic response body could not be serialized]'
  }
}

function headerValue(error: Record<string, unknown> | null, name: string): string | null {
  const headers = error?.headers
  if (headers instanceof Headers) return headers.get(name)

  const record = asRecord(headers)
  if (!record) return null
  return asString(record[name]) ?? asString(record[name.toLowerCase()])
}

function classifyFailure(
  status: number | null,
  providerType: string,
  providerMessage: string,
  errorName: string
): ClaudeFailureKind {
  if (errorName === 'ClaudeTimeoutError') return 'timeout'

  const detail = `${providerType} ${providerMessage}`.toLowerCase()
  if (/credit|billing|balance|payment|quota|spend limit|usage limit/.test(detail)) {
    return 'credit'
  }
  if (status === 401 || status === 403 || /authentication|unauthorized|permission/.test(detail)) {
    return 'auth'
  }
  if (status === 429 || /rate.?limit/.test(detail)) return 'rate_limit'
  if (
    status === 404 ||
    (/model/.test(detail) && /access|available|exist|find|not found/.test(detail))
  ) {
    return 'model_access'
  }
  if ([500, 502, 503, 504, 529].includes(status ?? 0)) return 'transient'
  if (status === 400) return 'invalid_request'
  return 'unknown'
}

export function toClaudeRequestError(
  error: unknown,
  metadata: ClaudeRequestMetadata
): ClaudeRequestError {
  if (error instanceof ClaudeRequestError) return error

  const raw = asRecord(error)
  const providerBodyValue = raw?.error ?? raw?.body ?? {
    type: raw?.type ?? raw?.name ?? 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }
  const providerBody = asRecord(providerBodyValue)
  const nestedError = asRecord(providerBody?.error)
  const providerType =
    asString(nestedError?.type) ??
    asString(providerBody?.type) ??
    asString(raw?.type) ??
    (error instanceof Error ? error.name : 'unknown_error')
  const providerMessage =
    asString(nestedError?.message) ??
    asString(providerBody?.message) ??
    (error instanceof Error ? error.message : String(error))
  const status = errorStatus(raw)
  const errorName = error instanceof Error ? error.name : 'UnknownError'
  const retryAfter = headerValue(raw, 'retry-after')

  return new ClaudeRequestError({
    ...metadata,
    status,
    providerType,
    providerMessage,
    providerBody: serializeProviderBody(providerBodyValue),
    requestId:
      asString(raw?.request_id) ??
      asString(providerBody?.request_id) ??
      headerValue(raw, 'request-id') ??
      headerValue(raw, 'x-request-id'),
    retryAfterSeconds: retryAfter ? Number.parseInt(retryAfter, 10) || null : null,
    kind: classifyFailure(status, providerType, providerMessage, errorName),
  })
}

export function toClaudeEmptyResponseError(
  metadata: ClaudeRequestMetadata,
  response: {
    id: string
    model: string
    stopReason: string | null
    contentTypes: string[]
  }
): ClaudeRequestError {
  return new ClaudeRequestError({
    ...metadata,
    kind: 'transient',
    status: 200,
    providerType: 'empty_response',
    providerMessage: 'Anthropic returned HTTP 200 with no text content',
    providerBody: JSON.stringify({
      id: response.id,
      model: response.model,
      stop_reason: response.stopReason,
      content_count: response.contentTypes.length,
      content_types: response.contentTypes,
    }),
    requestId: response.id,
    retryAfterSeconds: null,
  })
}
