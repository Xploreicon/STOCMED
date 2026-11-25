export type NotificationPreferences = {
  product_email_opt_in: boolean; refill_email_opt_in: boolean; reminder_sms_opt_in: boolean
  patient_email_consent: boolean; patient_sms_consent: boolean; patient_push_consent: boolean
}
export type SearchHistoryRow = {
  id: string; query_text: string; product_id: string | null; results_count: number | null
  location: string | null; searched_at: string; timestamp: string
}
export type SearchLog = { query: string; product_id?: string | null; results_count?: number | null; location?: string | null }
export type NativeCompletion = { destination: string }
export type NativeApiError = { error?: string; code?: string; message?: string; retryAfterSeconds?: number }
export type AssistantEvent = { type: 'delta'; text: string } | { type: 'done'; model?: string } | { type: 'error'; message: string; reason?: string }
