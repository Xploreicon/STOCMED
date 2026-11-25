import { test, expect, inventory, preferences } from './fixtures'
import path from 'node:path'

const patientRoutes = ['/dashboard/', '/chat/', '/search-results/?q=Paracetamol&location=Yaba',
  '/history/', '/reservations/', '/profile/', '/settings/']
const allRoutes = ['/', '/about/', '/privacy/', '/terms/', '/account/delete/',
  '/login/', '/signup/', '/complete-profile/', '/forgot-password/', '/update-password/', ...patientRoutes]

test('all 17 required route documents are present in the static export', async ({ request }) => {
  for (const path of allRoutes) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    expect(response.headers()['content-type'], path).toContain('text/html')
    expect(await response.text(), path).toContain('<html')
  }
})

for (const path of ['/', '/about/', '/privacy/', '/terms/', '/account/delete/']) {
  test(`public page renders ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.locator('a[href*="role=pharmacy"]')).toHaveCount(0)
  })
}

for (const [path, heading] of [['/login/', 'Welcome back'], ['/signup/?role=pharmacy', 'Create your patient account'],
  ['/forgot-password/', 'Reset password'], ['/update-password/', 'Request a new reset code']]) {
  test(`auth page renders safe patient state ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.locator('a[href*="role=pharmacy"]')).toHaveCount(0)
    await expect(page.getByText('Register your pharmacy', { exact: true })).toHaveCount(0)
  })
}

test.describe('password recovery', () => {
  test.use({ mockOptions: { identity: 'none', expectedConsoleErrors: ['status of 403 (Forbidden)'] } })
  test('hosted code flow rejects an expired code and updates only after recovery verification', async ({ page }) => {
    await page.goto('/forgot-password/')
    await page.getByLabel('Email address').fill('ade@example.test')
    await page.getByRole('button', { name: 'Send reset code' }).click()
    await expect(page.getByText('If that email is registered, a reset code is on its way.')).toBeVisible()
    await page.getByLabel('Reset code').fill('999999')
    await page.getByRole('button', { name: 'Verify code' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'invalid or has expired' })).toBeVisible()
    await page.getByLabel('Reset code').fill('123456')
    await page.getByRole('button', { name: 'Verify code' }).click()
    await expect(page).toHaveURL(/\/update-password\/?$/)
    await page.getByLabel('New password', { exact: true }).fill('Synthetic-new-password')
    await page.getByLabel('Confirm password', { exact: true }).fill('Synthetic-new-password')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()
  })
})

for (const path of patientRoutes) {
  test(`logged-out direct load is guarded ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login\/?\?redirectTo=/)
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
    await expect(page.locator('#app-main-content')).toHaveCount(0)
  })
}

test.describe('verified persisted patient', () => {
  test.use({ mockOptions: { identity: 'patient' } })

  for (const [path, heading] of [
    ['/dashboard/', /Good (morning|afternoon|evening), Ade/], ['/chat/', 'StocMed assistant'],
    ['/search-results/?q=Paracetamol&location=Yaba', 'Paracetamol near Yaba'],
    ['/history/', 'Search history'], ['/reservations/', 'My holds'], ['/profile/', 'Profile'], ['/settings/', 'Settings'],
  ] as const) {
    test(`patient page renders ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expect(page.locator('a[href^="/pharmacy"],a[href^="/admin"],a[href^="/insights"]')).toHaveCount(0)
      if (path === '/chat/') {
        await expect(page.locator('#app-main-content')).toHaveClass(/p-0/)
        await expect(page.getByRole('link', { name: 'Chat search', exact: true })).toHaveAttribute('aria-current', 'page')
      }
    })
  }

  test('dashboard uses persisted profile and retained search history', async ({ page }) => {
    await page.goto('/dashboard/')
    await expect(page.getByRole('heading', { name: /, Ade$/ })).toBeVisible()
    await expect(page.getByText('Untrusted Metadata', { exact: true })).toHaveCount(0)
    const recent = page.getByRole('link').filter({ hasText: 'Paracetamol' }).first()
    await expect(recent).toHaveAttribute('href', /\/chat\/?\?q=Paracetamol&location=Yaba/)
    await recent.click()
    await expect(page.getByText('Fixture pharmacy availability.', { exact: true })).toBeVisible()
  })

  test('history filters locally and repeats searches with retained area', async ({ page }) => {
    await page.goto('/history/')
    const entry = page.getByRole('link').filter({ hasText: 'Paracetamol' }).first()
    await expect(entry).toBeVisible()
    await page.getByLabel('Search history by medicine or area').fill('no-fixture-match')
    await expect(entry).toHaveCount(0)
    await page.getByLabel('Search history by medicine or area').fill('Yaba')
    await expect(entry).toHaveAttribute('href', /location=Yaba/)
    await page.getByRole('button', { name: 'Not recorded', exact: true }).click()
    await expect(entry).toHaveCount(0)
    await page.getByRole('button', { name: 'Matches found', exact: true }).click()
    await expect(entry).toBeVisible()
  })

  test('medicine results group named matches and same-ingredient alternatives separately', async ({ page, app }) => {
    const brand = { ...inventory, id: 'brand', name: 'Fixture Brand', brand_name: 'Fixture Brand' }
    const alternative = { ...inventory, id: 'alternative', name: 'Another Brand', brand_name: 'Another Brand' }
    const unrelated = { ...inventory, id: 'other', name: 'Other item', brand_name: 'Other item', generic_name: 'Another ingredient' }
    app.responses.set('GET /api/drugs/search', { json: { results: [unrelated, brand, alternative] } })
    await page.goto('/search-results/?q=Fixture%20Brand&location=Yaba')
    await expect(page.getByRole('region', { name: 'Direct matches' }).getByText('Fixture Brand 500mg')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Same active ingredient' }).getByText('Another Brand 500mg')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Other matches' }).getByText('Other item 500mg')).toBeVisible()
  })

  test('OTC pickup hold preserves bearer request, quantity and directions link', async ({ page, app }) => {
    await page.goto('/search-results/?q=Paracetamol&location=Yaba&inventory=inventory-1')
    await expect(page.getByRole('dialog', { name: 'Pharmacy details and pickup reservation' })).toBeVisible()
    await page.getByLabel('Quantity to hold (packs)').fill('2')
    await page.getByRole('button', { name: 'Hold for pickup', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Hold confirmed', exact: true })).toBeVisible()
    await expect(page.getByLabel('Pickup code TEST123')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', /https:\/\/www\.google\.com\/maps\/search\//)
    const hold = app.requests.filter(request => request.method === 'POST' && request.path === '/api/reservations')
    expect(hold).toHaveLength(1)
    expect(JSON.parse(hold[0].body!.toString())).toEqual({ inventory_id: 'inventory-1', quantity: 2 })
  })

  test('digital prescription uses destination-specific multipart without client storage upload', async ({ page, app }) => {
    app.responses.set('GET /api/drugs/search', { json: { results: [{ ...inventory, requires_prescription: true }] } })
    await page.goto('/search-results/?q=Paracetamol&location=Yaba&inventory=inventory-1')
    await page.locator('input[type="file"]').setInputFiles({ name: 'fixture-prescription.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nLocal fixture only') })
    await page.getByLabel('Exact quantity', { exact: true }).fill('2')
    await page.getByRole('button', { name: 'Send to pharmacist', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sent for review', exact: true })).toBeVisible()
    const submission = app.requests.find(request => request.method === 'POST' && request.path === '/api/reservations/prescription')!
    expect(submission).toBeDefined()
    expect(submission.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const body = submission.body!.toString()
    expect(body).toContain('name="inventory_id"\r\n\r\ninventory-1')
    expect(body).toContain('name="quantity"\r\n\r\n2')
    expect(body).toContain('name="file"; filename="fixture-prescription.pdf"')
  })

  test('symptom review stays closed and does not fetch medicine results', async ({ page, app }) => {
    app.responses.set('POST /api/triage', { json: { intent: 'SYMPTOM_GENERIC', risk_tier: 'CARE_REDIRECT', confidence: 1 } })
    await page.goto('/chat/')
    await page.getByLabel('Message the StocMed assistant').fill('I have a fever')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText(/Pharmacist symptom review is not available during the pilot/)).toBeVisible()
    expect(app.requests.some(request => request.path === '/api/drugs/search')).toBe(false)
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })

  test('logout aborts pending search and prevents later old-owner API work', async ({ page, app }) => {
    let release!: () => void
    const waitFor = new Promise<void>(resolve => { release = resolve })
    app.responses.set('GET /api/drugs/search', { json: { results: [inventory] }, waitFor })
    try {
      await page.goto('/chat/?location=Yaba')
      await page.getByLabel('Message the StocMed assistant').fill('Paracetamol')
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect.poll(() => app.requests.some(request => request.path === '/api/drugs/search')).toBe(true)
      await page.getByRole('button', { name: 'Account menu', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Log out', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
      release()
      await expect.poll(() => app.abortedPaths.includes('/api/drugs/search')).toBe(true)
      await expect(page.locator('#app-main-content')).toHaveCount(0)
      expect(app.requests.filter(request => request.path === '/api/searches' || request.path === '/api/chat/assistant')).toHaveLength(0)
      expect(await page.evaluate(() => localStorage.getItem('stocmed:patient:session:v1'))).toBeNull()
    } finally { release() }
  })
})

test.describe('authoritative guards', () => {
  test.describe('persisted pharmacy with patient metadata', () => {
    test.use({ mockOptions: { identity: 'pharmacy' } })
    test('cannot enter the patient dashboard', async ({ page }) => {
      await page.goto('/dashboard/')
      await expect(page.getByRole('heading', { name: 'Patient accounts only' })).toBeVisible()
      await expect(page.locator('#app-main-content')).toHaveCount(0)
    })
  })
  test.describe('roleless account', () => {
    test.use({ mockOptions: { identity: 'roleless' } })
    test('opens patient profile completion', async ({ page }) => {
      await page.goto('/dashboard/')
      await expect(page).toHaveURL(/\/complete-profile\/?$/)
      await expect(page.getByRole('heading', { name: 'Finish your patient profile' })).toBeVisible()
      await expect(page.locator('a[href*="role=pharmacy"]')).toHaveCount(0)
    })
  })
  test.describe('profile service failure', () => {
    test.use({ mockOptions: { identity: 'patient', profileError: true,
      expectedConsoleErrors: ['Failed to load resource: the server responded with a status of 503'] } })
    test('shows retry instead of treating an error as onboarding', async ({ page }) => {
      await page.goto('/dashboard/')
      await expect(page.getByRole('button', { name: 'Retry account check' })).toBeVisible()
      await expect(page).toHaveURL(/\/dashboard\/?$/)
      await expect(page.locator('#app-main-content')).toHaveCount(0)
    })
  })
  test.describe('patient missing search location', () => {
    test.use({ mockOptions: { identity: 'patient', location: null } })
    test('requires profile location before dashboard', async ({ page }) => {
      await page.goto('/dashboard/')
      await expect(page).toHaveURL(/\/profile\/?\?required=location/)
      await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    })
  })
})

test.describe('390 × 844 Chromium layout', () => {
  test.use({ mockOptions: { identity: 'patient' }, viewport: { width: 390, height: 844 } })
  for (const route of ['dashboard', 'chat']) {
    test(`mobile ${route} remains usable without horizontal overflow`, async ({ page }) => {
      await page.goto(`/${route}/`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Patient mobile navigation' })).toBeVisible()
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1)).toBe(true)
      const main = page.locator('#app-main-content')
      expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      if (route === 'chat') {
        await expect(main).toHaveClass(/p-0/)
        await expect(page.getByLabel('Message the StocMed assistant')).toBeInViewport()
      }
      await page.screenshot({ path: path.resolve(process.cwd(), `../../.verification/patient-mobile-${route}.png`) })
    })
  }
})

test.describe('controlled API failures', () => {
  test.use({ mockOptions: { identity: 'patient', expectedConsoleErrors: [
    'Failed to load resource: the server responded with a status of 503',
    'Failed to load resource: the server responded with a status of 409', 'Triage check error:',
  ] } })

  test('triage failure stops medicine search', async ({ page, app }) => {
    app.responses.set('POST /api/triage', { status: 503, json: { error: 'Fixture unavailable' } })
    await page.goto('/chat/')
    await page.getByLabel('Message the StocMed assistant').fill('Paracetamol')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText(/could not complete the required safety check/)).toBeVisible()
    expect(app.requests.some(request => request.path === '/api/drugs/search')).toBe(false)
  })

  test('inventory conflict shows no false pickup confirmation', async ({ page, app }) => {
    app.responses.set('POST /api/reservations', { status: 409, json: { error: 'Fixture inventory changed' } })
    await page.goto('/search-results/?q=Paracetamol&location=Yaba&inventory=inventory-1')
    await page.getByRole('button', { name: 'Hold for pickup', exact: true }).click()
    await expect(page.getByText(/Availability changed while you were submitting/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Hold confirmed', exact: true })).toHaveCount(0)
    expect(app.requests.filter(request => request.method === 'POST' && request.path === '/api/reservations')).toHaveLength(1)
  })

  test('notification preferences stay unchanged on save error and can retry', async ({ page, app }) => {
    app.responses.set('PUT /api/notifications/preferences', { status: 503, json: { error: 'Fixture save unavailable' } })
    await page.goto('/settings/')
    const email = page.getByLabel('Allow email notifications', { exact: true })
    await expect(email).not.toBeChecked()
    await email.click()
    await expect(page.getByText('Fixture save unavailable', { exact: true })).toBeVisible()
    await expect(email).not.toBeChecked()
    app.responses.set('PUT /api/notifications/preferences', { json: { preferences: { ...preferences, patient_email_consent: true } } })
    await email.click()
    await expect(email).toBeChecked()
    expect(app.requests.filter(request => request.method === 'PUT' && request.path === '/api/notifications/preferences')).toHaveLength(2)
  })

  test('preferences require a complete snapshot before saving and preserve existing push consent', async ({ page, app }) => {
    app.responses.set('GET /api/notifications/preferences', { json: { preferences: { patient_email_consent: false } } })
    await page.goto('/settings/')
    const email = page.getByLabel('Allow email notifications', { exact: true })
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load notification preferences' })).toBeVisible()
    await expect(email).toHaveCount(0)
    app.responses.set('GET /api/notifications/preferences', { json: { preferences: { ...preferences, patient_push_consent: true } } })
    await page.getByRole('button', { name: 'Retry preferences' }).click()
    await email.click()
    await expect(email).toBeChecked()
    const writes = app.requests.filter(request => request.method === 'PUT' && request.path === '/api/notifications/preferences')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body!.toString())).toMatchObject({ patient_push_consent: true, patient_email_consent: true })
    expect(app.requests.some(request => request.path.startsWith('/api/push/'))).toBe(false)
  })

  test('one reservations resource can fail while the other remains usable', async ({ page, app }) => {
    app.responses.set('GET /api/reservations/prescription', { status: 503, json: { error: 'Fixture review unavailable' } })
    await page.goto('/reservations/')
    await expect(page.locator('section[aria-labelledby="active-holds-heading"]').getByText('You have no active pickup holds.', { exact: false })).toBeVisible()
    await expect(page.getByText('We could not load this information. Check your connection and try again.', { exact: true })).toBeVisible()
  })
})
