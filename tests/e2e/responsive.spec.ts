import { expect, test, type Page } from '@playwright/test'

const password = process.env.TEST_PASSWORD || 'StocMedTest123!'

test.setTimeout(300_000)

async function assertResponsive(page: Page, name: string) {
  await expect(page.locator('body')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 20_000 })
  if (name === 'history') {
    await expect(page.getByRole('heading', { name: 'Search history' })).toBeVisible()
  }
  if (name === 'pos') {
    await expect(page.getByText('StocMed Test Pharmacy', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  }
  if (name === 'pharmacy-dashboard') {
    await expect(page.getByTestId('reorder-loading')).toHaveCount(0, { timeout: 20_000 })
  }
  const layout = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const viewportWidth = window.innerWidth
    return {
      horizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) > viewportWidth + 1,
      clippedControls: [...document.querySelectorAll<HTMLElement>('button,a,input,select,textarea')]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return style.display !== 'none' && rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1)
        })
        .map((element) => element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName),
    }
  })
  expect(layout.horizontalOverflow, `${name} has page-level horizontal overflow`).toBe(false)
  expect(layout.clippedControls, `${name} has clipped controls`).toEqual([])
  await page.screenshot({ path: `artifacts/playwright/${test.info().project.name}-${name}.png`, fullPage: true })
}

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

test('public pages are responsive', async ({ page }) => {
  for (const [name, path] of [['landing', '/'], ['login', '/login'], ['signup', '/signup']] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await assertResponsive(page, name)
  }
})

test('patient pages are responsive', async ({ page }) => {
  await login(page, process.env.TEST_PATIENT_EMAIL || 'patient.test@stocmed.local')
  for (const [name, path] of [['patient-dashboard', '/dashboard'], ['chat', '/chat'], ['history', '/history'], ['profile', '/profile'], ['settings', '/settings']] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}(?:\\?|$)`))
    await assertResponsive(page, name)
  }
})

test('pharmacy workflows are responsive', async ({ page }) => {
  await login(page, process.env.TEST_PHARMACY_EMAIL || 'pharmacy.test@stocmed.local')
  for (const [name, path] of [['pharmacy-dashboard', '/pharmacy/dashboard'], ['inventory', '/pharmacy/inventory'], ['import', '/pharmacy/inventory/import'], ['expiry-capture', '/pharmacy/inventory/expiry-capture'], ['procurement', '/pharmacy/procurement'], ['pos', '/pharmacy/pos'], ['shifts', '/pharmacy/shifts'], ['reports', '/pharmacy/reports']] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}(?:\\?|$)`))
    await assertResponsive(page, name)
  }
})
