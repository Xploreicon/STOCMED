const LAGOS_TIME_ZONE = 'Africa/Lagos'

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function formatOperatingHours(
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
) {
  const opening = timeToMinutes(openingTime)
  const closing = timeToMinutes(closingTime)
  if (opening === null || closing === null) return null
  const format = (minutes: number) => {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const suffix = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
  }
  return `${format(opening)}–${format(closing)}`
}

export function isPharmacyOpenNow(
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  now = new Date(),
): boolean | null {
  const opening = timeToMinutes(openingTime)
  const closing = timeToMinutes(closingTime)
  if (opening === null || closing === null) return null
  if (opening === closing) return true

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const current = hour * 60 + minute

  return opening < closing
    ? current >= opening && current < closing
    : current >= opening || current < closing
}
