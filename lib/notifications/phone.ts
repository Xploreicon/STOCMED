export function normalizeNigerianPhone(input: string) {
  const compact = input.trim().replace(/[\s().-]/g, '')
  let national: string

  if (/^0\d{10}$/.test(compact)) {
    national = compact.slice(1)
  } else if (/^\+234\d{10}$/.test(compact)) {
    national = compact.slice(4)
  } else if (/^234\d{10}$/.test(compact)) {
    national = compact.slice(3)
  } else {
    throw new Error('Enter a valid Nigerian mobile number')
  }

  if (!/^[789][01]\d{8}$/.test(national)) {
    throw new Error('Enter a valid Nigerian mobile number')
  }

  return `+234${national}`
}

export function toTermiiPhone(input: string) {
  return normalizeNigerianPhone(input).slice(1)
}
