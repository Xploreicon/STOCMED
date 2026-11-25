export const PATIENT_API_ORIGIN = 'https://www.askstocmed.com'

export function getPublicApiOrigin() {
  const configured = process.env.NEXT_PUBLIC_STOCMED_API_ORIGIN
  if (configured && configured !== PATIENT_API_ORIGIN) throw new Error('The patient API origin is not supported.')
  return PATIENT_API_ORIGIN
}

export function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Sign-in is unavailable until this app is configured.')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('The authentication service must use HTTPS.')
  }
  return { url: parsed.href.replace(/\/$/, ''), key }
}
