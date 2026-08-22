export function buildWhatsAppReceiptLink(phone: string, receipt: string) {
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  if (!/^234[789][01]\d{8}$/.test(normalized)) throw new Error('A valid Nigerian WhatsApp number is required')
  return `https://wa.me/${normalized}?text=${encodeURIComponent(receipt)}`
}
