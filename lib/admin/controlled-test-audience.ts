const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseControlledTestRecipientEmails(value?: string) {
  const emails = Array.from(new Set(
    (value || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  ))

  if (emails.length !== 2 || emails.some(email => !EMAIL_PATTERN.test(email))) {
    throw new Error('NOTIFICATION_TEST_RECIPIENTS must contain exactly two unique email addresses')
  }
  return emails
}
