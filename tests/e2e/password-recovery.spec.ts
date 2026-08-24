import { Client } from 'pg'
import { expect, test, type Page } from '@playwright/test'

const email = process.env.TEST_PHARMACY_EMAIL || 'pharmacy.test@stocmed.local'
const originalPassword = process.env.TEST_PASSWORD || 'StocMedTest123!'
const databaseUrl = process.env.STOCMED_LOCAL_DB_URL
const mailpitUrl = process.env.STOCMED_LOCAL_MAILPIT_URL || 'http://127.0.0.1:55324'
const enabled = process.env.STOCMED_RUN_AUTH_RECOVERY_E2E === '1'

test.setTimeout(300_000)
test.use({ bypassCSP: true })
test.skip(!enabled, 'Set STOCMED_RUN_AUTH_RECOVERY_E2E=1 to run this local-only recovery audit.')

function expectLoopbackUrl(rawUrl: string, label: string) {
  const parsed = new URL(rawUrl)
  expect(
    ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname),
    `${label} must be loopback-only; received ${parsed.hostname}`,
  ).toBeTruthy()
}

type MailpitSummary = {
  ID: string
  Created: string
  Subject: string
  To: Array<{ Address: string }>
}

async function waitForRecoveryCode(requestedAt: number): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`)
    expect(listResponse.ok).toBe(true)
    const list = await listResponse.json() as { messages: MailpitSummary[] }
    const message = list.messages.find(candidate =>
      candidate.Subject === 'Your StocMed password reset code'
      && candidate.To.some(recipient => recipient.Address === email)
      && Date.parse(candidate.Created) >= requestedAt - 1_000,
    )

    if (message) {
      const messageResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`)
      expect(messageResponse.ok).toBe(true)
      const body = await messageResponse.json() as { Text: string; HTML: string }
      expect(body.HTML).not.toContain('ConfirmationURL')
      expect(body.Text).not.toMatch(/https?:\/\/\S+\/auth\/v1\/verify/)
      const match = body.Text.match(/\b(\d{6})\b/)
      if (match) return match[1]
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the local Supabase recovery-code email')
}

async function signIn(page: Page, password: string) {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

test('password recovery email code changes the password and supports sign-in', async ({ page, baseURL }) => {
  test.skip(
    test.info().project.name !== 'tablet-1024x768',
    'This test mutates and restores one local auth fixture, so it runs in exactly one project.',
  )
  expect(baseURL, 'Playwright baseURL is required').toBeTruthy()
  expect(databaseUrl, 'STOCMED_LOCAL_DB_URL is required').toBeTruthy()
  expectLoopbackUrl(baseURL!, 'PLAYWRIGHT_BASE_URL')
  expectLoopbackUrl(databaseUrl!, 'STOCMED_LOCAL_DB_URL')
  expectLoopbackUrl(mailpitUrl, 'STOCMED_LOCAL_MAILPIT_URL')

  const database = new Client({ connectionString: databaseUrl })
  await database.connect()
  const replacementPassword = `StocMedReset${Date.now()}!`

  try {
    await test.step('the legacy update route cannot expose an unguarded password form', async () => {
      await page.goto('/update-password')
      await expect(page.getByRole('heading', { name: 'Enter your reset code' })).toBeVisible()
      await expect(page.getByLabel('New password')).toHaveCount(0)
    })

    const requestedAt = Date.now()
    await page.goto('/forgot-password')
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Send reset code' }).click()
    await page.waitForURL('**/reset-password?sent=1')
    await expect(page.getByText('If that email is registered, a password reset code has been sent.')).toBeVisible()

    const code = await waitForRecoveryCode(requestedAt)
    await page.getByLabel('Reset code').fill(code)
    await page.getByRole('button', { name: 'Verify code' }).click()
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()

    await page.getByLabel('New password').fill(replacementPassword)
    await page.getByLabel('Confirm password').fill(replacementPassword)
    await page.getByRole('button', { name: 'Update password' }).click()
    await page.waitForURL('**/login?password-reset=success')
    await expect(page.getByText('Your password has been updated. Sign in with your new password.')).toBeVisible()

    await signIn(page, replacementPassword)
    await expect(page).not.toHaveURL(/\/login/)
  } finally {
    await database.query(
      `UPDATE auth.users
          SET encrypted_password = crypt($2, gen_salt('bf')),
              updated_at = NOW()
        WHERE email = $1`,
      [email, originalPassword],
    )
    await database.end()
  }
})
