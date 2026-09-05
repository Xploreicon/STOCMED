export type SearchDigestFrequency = 'daily' | 'hourly'

export function getSearchDigestWindow(
  now: Date,
  options: { frequency?: string; dailyUtcHour?: number } = {},
) {
  const frequency: SearchDigestFrequency = options.frequency === 'hourly' ? 'hourly' : 'daily'
  const configuredHour = Number.isInteger(options.dailyUtcHour)
    ? Number(options.dailyUtcHour)
    : 6
  const dailyUtcHour = Math.min(23, Math.max(0, configuredHour))
  const due = frequency === 'hourly' || now.getUTCHours() === dailyUtcHour
  const hours = frequency === 'hourly' ? 1 : 24
  return {
    due,
    frequency,
    since: new Date(now.getTime() - hours * 60 * 60 * 1000),
    until: now,
    periodKey: frequency === 'hourly'
      ? now.toISOString().slice(0, 13)
      : now.toISOString().slice(0, 10),
  }
}
