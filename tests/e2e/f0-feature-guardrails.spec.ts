import { Client } from 'pg'
import { expect, test, type Page } from '@playwright/test'

const pharmacyEmail = process.env.TEST_PHARMACY_EMAIL || 'pharmacy.test@stocmed.local'
const patientEmail = process.env.TEST_PATIENT_EMAIL || 'patient.test@stocmed.local'
const password = process.env.TEST_PASSWORD || 'StocMedTest123!'
const databaseUrl = process.env.STOCMED_LOCAL_DB_URL
const guardrailAuditEnabled = process.env.STOCMED_RUN_F0_E2E === '1'

const comingSoonFeatures = [
  'Staff PINs',
  'Customer records',
  'Sell on credit',
  'Owner updates',
  'WhatsApp receipts',
  'Local price comparison',
  'Smart reorder suggestions',
  'What customers cannot find',
  'Customer loyalty',
] as const

test.setTimeout(300_000)
test.use({ bypassCSP: true })
test.skip(
  !guardrailAuditEnabled,
  'Set STOCMED_RUN_F0_E2E=1 to run this local-only guardrail audit.',
)

function expectLoopbackUrl(rawUrl: string, label: string) {
  const parsed = new URL(rawUrl)
  expect(
    ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname),
    `${label} must be loopback-only; received ${parsed.hostname}`,
  ).toBeTruthy()
}

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

test('F0 prevents unbuilt features from promising success', async ({ browser, page, baseURL }) => {
  test.skip(
    test.info().project.name !== 'tablet-1024x768',
    'F0 mutates and restores one local fixture row, so it runs in exactly one project.',
  )
  expect(baseURL, 'Playwright baseURL is required').toBeTruthy()
  expect(databaseUrl, 'STOCMED_LOCAL_DB_URL is required').toBeTruthy()
  expectLoopbackUrl(baseURL!, 'PLAYWRIGHT_BASE_URL')
  expectLoopbackUrl(databaseUrl!, 'STOCMED_LOCAL_DB_URL')

  const database = new Client({ connectionString: databaseUrl })
  await database.connect()

  let fixturePharmacyId: string | null = null
  let fixtureUserId: string | null = null
  let originalCreditEnabled = false
  let originalCreditEnabledAt: Date | null = null
  let originalCreditEnabledBy: string | null = null

  try {
    const fixture = await database.query<{
      pharmacy_id: string
      user_id: string
      is_enabled: boolean
      enabled_at: Date | null
      enabled_by: string | null
    }>(
      `SELECT pharmacy.id AS pharmacy_id, pharmacy.user_id,
              feature.is_enabled, feature.enabled_at, feature.enabled_by
         FROM public.pharmacies pharmacy
         JOIN auth.users auth_user ON auth_user.id = pharmacy.user_id
         JOIN public.pharmacy_features feature
           ON feature.pharmacy_id = pharmacy.id
          AND feature.feature_key = 'credit_sales'
        WHERE auth_user.email = $1`,
      [pharmacyEmail],
    )
    expect(fixture.rowCount).toBe(1)
    fixturePharmacyId = fixture.rows[0].pharmacy_id
    fixtureUserId = fixture.rows[0].user_id
    originalCreditEnabled = fixture.rows[0].is_enabled
    originalCreditEnabledAt = fixture.rows[0].enabled_at
    originalCreditEnabledBy = fixture.rows[0].enabled_by
    await database.query(
      `UPDATE public.pharmacy_features
          SET is_enabled = TRUE, enabled_at = NOW(), enabled_by = $2
        WHERE pharmacy_id = $1 AND feature_key = 'credit_sales'`,
      [fixturePharmacyId, fixtureUserId],
    )

    await login(page, pharmacyEmail)

    await test.step('coming-soon and hidden features cannot masquerade as available', async () => {
      await page.goto('/pharmacy/settings/features')
      await expect(page.getByRole('heading', { name: 'Features', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.locator('article')).toHaveCount(13)

      for (const name of comingSoonFeatures) {
        const card = page.locator('article').filter({
          has: page.getByRole('heading', { name, exact: true }),
        })
        await expect(card).toHaveCount(1)
        await expect(card.getByText('Coming soon', { exact: true }).first()).toBeVisible()
        await expect(card.getByRole('button', { name: 'Coming soon' })).toBeDisabled()
        await expect(card.getByText(/It can't be turned on yet\./)).toBeVisible()
      }

      await expect(page.getByRole('heading', { name: 'More than one branch' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Near-expiry stock exchange' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Multi-branch owner' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Full retail shop' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Buying & stock' })).toBeEnabled()

      const profile = await page.evaluate(async () => {
        const response = await fetch('/api/pharmacy/profile')
        return response.json() as Promise<{ id: string }>
      })
      expect(profile.id).toBe(fixturePharmacyId)
      const before = await database.query<{ is_enabled: boolean }>(
        `SELECT is_enabled
           FROM public.pharmacy_features
          WHERE pharmacy_id = $1 AND feature_key = 'credit_sales'`,
        [profile.id],
      )
      expect(before.rows).toEqual([{ is_enabled: true }])

      const rejection = await page.evaluate(async () => {
        const response = await fetch('/api/pharmacy/features', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature_key: 'credit_sales', is_enabled: true }),
        })
        return { status: response.status, body: await response.json() }
      })
      expect(rejection).toMatchObject({
        status: 409,
        body: { code: 'FEATURE_UNAVAILABLE', feature_key: 'credit_sales' },
      })

      const hiddenRejection = await page.evaluate(async () => {
        const response = await fetch('/api/pharmacy/features', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature_key: 'multi_branch', is_enabled: true }),
        })
        return { status: response.status, body: await response.json() }
      })
      expect(hiddenRejection).toMatchObject({
        status: 409,
        body: { code: 'FEATURE_UNAVAILABLE', feature_key: 'multi_branch' },
      })

      const after = await database.query<{ is_enabled: boolean }>(
        `SELECT is_enabled
           FROM public.pharmacy_features
          WHERE pharmacy_id = $1 AND feature_key = 'credit_sales'`,
        [profile.id],
      )
      expect(after.rows).toEqual(before.rows)

      const preset = await page.evaluate(async () => {
        const response = await fetch('/api/pharmacy/features', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset: 'full_retail_shop' }),
        })
        return { status: response.status, body: await response.json() }
      })
      expect(preset).toMatchObject({
        status: 200,
        body: {
          changed: [],
          skipped: ['staff_accounts', 'customers', 'credit_sales', 'notifications'],
        },
      })
    })

    await test.step('the pharmacy dashboard contains no fabricated activity', async () => {
      await page.goto('/pharmacy/dashboard')
      await expect(page.getByText('Recent activity', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Demand near you', { exact: true })).toHaveCount(0)
      await expect(page.getByText(/Chidi made a sale|patients created restock alerts/i)).toHaveCount(0)
      await expect(page.getByRole('link', { name: /View reports/ })).toHaveAttribute(
        'href',
        '/pharmacy/reports',
      )
    })

    await test.step('patient notification controls disclose that delivery is not built', async () => {
      const patientContext = await browser.newContext({ baseURL, bypassCSP: true })
      const patientPage = await patientContext.newPage()
      const notificationRequests: string[] = []
      patientPage.on('request', request => {
        if (request.url().includes('/api/notifications')) notificationRequests.push(request.url())
      })
      await patientPage.addInitScript(() => {
        localStorage.setItem('stocmed:notif_stock', 'true')
        localStorage.setItem('stocmed:notif_price', 'true')
        localStorage.setItem('stocmed:notif_refills', 'true')
      })

      try {
        await login(patientPage, patientEmail)
        await patientPage.goto('/settings')
        await expect(patientPage.getByText('Coming soon', { exact: true })).toBeVisible({
          timeout: 30_000,
        })
        await expect(patientPage.getByText(/Nothing is being saved or sent yet\./)).toBeVisible()

        for (const name of [
          'Back-in-stock alerts',
          'Price-drop alerts',
          'Chronic med refill reminders',
        ]) {
          const checkbox = patientPage.getByRole('checkbox', { name })
          await expect(checkbox).toBeDisabled()
          await expect(checkbox).not.toBeChecked()
        }

        expect(notificationRequests).toEqual([])
        await expect(patientPage.getByText(/alerts preference updated/i)).toHaveCount(0)
      } finally {
        await patientContext.close()
      }
    })
  } finally {
    if (fixturePharmacyId) {
      await database.query(
        `UPDATE public.pharmacy_features
            SET is_enabled = $2, enabled_at = $3, enabled_by = $4
          WHERE pharmacy_id = $1 AND feature_key = 'credit_sales'`,
        [
          fixturePharmacyId,
          originalCreditEnabled,
          originalCreditEnabledAt,
          originalCreditEnabledBy,
        ],
      )
    }
    await database.end()
  }
})
