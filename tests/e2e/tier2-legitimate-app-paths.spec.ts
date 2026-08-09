import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { Client, type QueryResultRow } from 'pg'
import { expect, test, type APIResponse, type Page } from '@playwright/test'

const pharmacyEmail =
  process.env.TEST_PHARMACY_EMAIL || 'pharmacy.test@stocmed.local'
const password = process.env.TEST_PASSWORD || 'StocMedTest123!'
const spCode = process.env.TEST_SP_CODE || '246810'
const databaseUrl = process.env.STOCMED_LOCAL_DB_URL
const mutationsEnabled = process.env.STOCMED_RUN_TIER2_APP_E2E === '1'

test.setTimeout(300_000)
// Production CSP permits the hosted auth domain. This test is hard-gated to a
// loopback app/database and must reach the real local Supabase auth port.
test.use({ bypassCSP: true })
test.skip(
  !mutationsEnabled,
  'Set STOCMED_RUN_TIER2_APP_E2E=1 to run this intentionally mutating local-only audit.',
)

type JsonObject = Record<string, unknown>

type PharmacyProfile = JsonObject & {
  id: string
  pharmacy_name: string
  reservations_enabled: boolean
}

type SpConfiguration = {
  configured: boolean
  discountThreshold: number
  graceMinutes: number
  requireFinancialReports: boolean
  gates: Array<{ action_key: string; is_gated: boolean }>
}

type FeatureRow = {
  feature_key: string
  is_enabled: boolean
}

type InventoryItem = {
  id: string
  pharmacy_id: string
  price: number
  quantity_in_stock: number
  deleted_at: string | null
  batches: Array<{ id: string; batch_number: string; remaining_qty: number }>
}

function expectLoopbackUrl(rawUrl: string, label: string) {
  const parsed = new URL(rawUrl)
  expect(
    ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname),
    `${label} must be loopback-only; received ${parsed.hostname}`,
  ).toBeTruthy()
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(pharmacyEmail)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).toHaveURL(/\/pharmacy\/dashboard/, { timeout: 30_000 })
}

async function json<T>(response: APIResponse): Promise<T> {
  const raw = await response.text()
  expect(
    response.ok(),
    `${response.url()} returned ${response.status()}: ${raw}`,
  ).toBeTruthy()
  return JSON.parse(raw) as T
}

async function expectJsonFailure(
  response: APIResponse,
  status: number,
  code?: string,
) {
  const raw = await response.text()
  let body: JsonObject = {}
  try {
    body = JSON.parse(raw) as JsonObject
  } catch {
    // The status assertion below still reports the non-JSON response body.
  }
  expect(
    response.status(),
    `${response.url()} returned ${response.status()}: ${raw}`,
  ).toBe(status)
  if (code) expect(body.code).toBe(code)
  return body
}

async function one<T extends QueryResultRow>(
  database: Client,
  query: string,
  values: unknown[] = [],
) {
  const result = await database.query<T>(query, values)
  expect(result.rowCount, `Expected one database row for: ${query}`).toBe(1)
  return result.rows[0]
}

async function authorize(page: Page, action: string, target: string) {
  const response = await page.context().request.post('/api/pharmacy/sp-authorization', {
    data: { code: spCode, action, target },
  })
  const body = await json<{ token: string }>(response)
  expect(body.token.length).toBeGreaterThanOrEqual(32)
  return body.token
}

function dateDaysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

test('Tier-2 legitimate authenticated app write paths remain usable and authoritative', async ({
  page,
  baseURL,
}) => {
  expect(baseURL, 'Playwright baseURL is required').toBeTruthy()
  expect(databaseUrl, 'STOCMED_LOCAL_DB_URL is required').toBeTruthy()
  expectLoopbackUrl(baseURL!, 'PLAYWRIGHT_BASE_URL')
  expectLoopbackUrl(databaseUrl!, 'STOCMED_LOCAL_DB_URL')

  const database = new Client({ connectionString: databaseUrl })
  const api = page.context().request
  const createdInventoryIds: string[] = []
  let restoreConfiguration: (() => Promise<APIResponse[]>) | null = null
  let configurationRestored = false
  let configurationChanged = false

  await database.connect()
  try {
    await test.step('sign in and bind the browser session to the local seeded tenant', async () => {
      await login(page)

      const profileResponse = await api.get('/api/pharmacy/profile')
      const profile = await json<PharmacyProfile>(profileResponse)
      expect(Object.hasOwn(profile, 'sp_code_hash')).toBe(false)

      const localTenant = await one<{ id: string; user_id: string; email: string }>(
        database,
        `SELECT pharmacy.id, pharmacy.user_id, auth_user.email
           FROM public.pharmacies pharmacy
           JOIN auth.users auth_user ON auth_user.id = pharmacy.user_id
          WHERE pharmacy.id = $1`,
        [profile.id],
      )
      expect(localTenant.email).toBe(pharmacyEmail)

      const openShift = await one<{ count: number }>(
        database,
        `SELECT COUNT(*)::INTEGER AS count
           FROM public.shifts
          WHERE pharmacy_id = $1 AND status = 'open'`,
        [profile.id],
      )
      expect(
        openShift.count,
        'This audit requires a clean local tenant with no pre-existing open shift.',
      ).toBe(0)
    })

    const profile = await json<PharmacyProfile>(await api.get('/api/pharmacy/profile'))
    const localTenant = await one<{ id: string; user_id: string }>(
      database,
      'SELECT id, user_id FROM public.pharmacies WHERE id = $1',
      [profile.id],
    )
    const originalSp = await json<SpConfiguration>(
      await api.get('/api/pharmacy/sp-authorization'),
    )
    const originalFeatures = await json<{ features: FeatureRow[] }>(
      await api.get('/api/pharmacy/features'),
    )
    const originalFeatureState = new Map(
      originalFeatures.features.map((feature) => [feature.feature_key, feature.is_enabled]),
    )
    const originalGates = Object.fromEntries(
      originalSp.gates.map((gate) => [gate.action_key, gate.is_gated]),
    )

    restoreConfiguration = async () => {
      if (!configurationChanged) return []
      const responses: APIResponse[] = []
      responses.push(await api.put('/api/pharmacy/features', {
        data: {
          feature_key: 'packs_and_units',
          is_enabled: originalFeatureState.get('packs_and_units') ?? false,
          currentCode: spCode,
        },
      }))
      responses.push(await api.put('/api/pharmacy/features', {
        data: {
          feature_key: 'reservations',
          is_enabled: profile.reservations_enabled,
          currentCode: spCode,
        },
      }))
      responses.push(await api.patch('/api/pharmacy/sp-authorization', {
        data: {
          discountThreshold: originalSp.discountThreshold,
          graceMinutes: originalSp.graceMinutes,
          requireFinancialReports: originalSp.requireFinancialReports,
          currentCode: spCode,
        },
      }))
      responses.push(await api.put('/api/pharmacy/sp-authorization', {
        data: {
          operation: 'set_gates',
          currentCode: spCode,
          gates: originalGates,
        },
      }))
      if (!originalSp.configured) {
        responses.push(await api.delete('/api/pharmacy/sp-authorization', {
          data: { currentCode: spCode },
        }))
      }
      return responses
    }

    await test.step('configure SP controls and prove feature/reservation changes use the current code', async () => {
      const setCode = await api.put('/api/pharmacy/sp-authorization', {
        data: {
          operation: 'set_code',
          newCode: spCode,
          ...(originalSp.configured ? { currentCode: spCode } : {}),
        },
      })
      const setCodeBody = await json<{ success: boolean; configured: boolean }>(setCode)
      expect(setCodeBody).toMatchObject({ success: true, configured: true })
      configurationChanged = true

      const changedThreshold = originalSp.discountThreshold === 13 ? 14 : 13
      const changedGrace = originalSp.graceMinutes === 7 ? 8 : 7
      const updateSettings = await api.patch('/api/pharmacy/sp-authorization', {
        data: {
          discountThreshold: changedThreshold,
          graceMinutes: changedGrace,
          requireFinancialReports: true,
          currentCode: spCode,
        },
      })
      expect(await json<{ success: boolean }>(updateSettings)).toMatchObject({ success: true })

      const setGates = await api.put('/api/pharmacy/sp-authorization', {
        data: {
          operation: 'set_gates',
          currentCode: spCode,
          gates: {
            price_change: true,
            stock_adjustment: true,
            delist_inventory: true,
            restore_inventory: true,
            void_or_refund: true,
            financial_reports: true,
            data_export: true,
          },
        },
      })
      expect(await json<{ success: boolean }>(setGates)).toMatchObject({ success: true })
      const configured = await json<SpConfiguration>(
        await api.get('/api/pharmacy/sp-authorization'),
      )
      expect(configured).toMatchObject({
        configured: true,
        discountThreshold: changedThreshold,
        graceMinutes: changedGrace,
        requireFinancialReports: true,
      })

      const noCodeFeatureChange = await api.put('/api/pharmacy/features', {
        data: { feature_key: 'reservations', is_enabled: !profile.reservations_enabled },
      })
      await expectJsonFailure(noCodeFeatureChange, 403, 'SP_CURRENT_CODE_REQUIRED')

      const enablePacks = await api.put('/api/pharmacy/features', {
        data: {
          feature_key: 'packs_and_units',
          is_enabled: true,
          currentCode: spCode,
        },
      })
      expect((await json<{ features: FeatureRow[] }>(enablePacks)).features).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ feature_key: 'packs_and_units', is_enabled: true }),
        ]),
      )

      const toggleReservations = await api.put('/api/pharmacy/features', {
        data: {
          feature_key: 'reservations',
          is_enabled: !profile.reservations_enabled,
          currentCode: spCode,
        },
      })
      expect((await json<{ features: FeatureRow[] }>(toggleReservations)).features).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            feature_key: 'reservations',
            is_enabled: !profile.reservations_enabled,
          }),
        ]),
      )
      const toggledProfile = await json<PharmacyProfile>(await api.get('/api/pharmacy/profile'))
      expect(toggledProfile.reservations_enabled).toBe(!profile.reservations_enabled)
      const toggledPersistence = await one<{
        reservations_enabled: boolean
        feature_enabled: boolean
      }>(database, `
        SELECT pharmacy.reservations_enabled,
               feature.is_enabled AS feature_enabled
          FROM public.pharmacies pharmacy
          JOIN public.pharmacy_features feature
            ON feature.pharmacy_id = pharmacy.id
           AND feature.feature_key = 'reservations'
         WHERE pharmacy.id = $1`, [profile.id])
      expect(toggledPersistence).toEqual({
        reservations_enabled: !profile.reservations_enabled,
        feature_enabled: !profile.reservations_enabled,
      })
    })

    let medication!: InventoryItem
    let originalBatchId!: string
    let priceToken!: string
    let stockToken!: string
    let delistToken!: string
    let restoreToken!: string

    await test.step('create a catalogue medicine and add it to inventory through the app routes', async () => {
      const suffix = randomUUID().slice(0, 8)
      const [dosageForm, category] = await Promise.all([
        one<{ name: string }>(database, 'SELECT name FROM public.dosage_forms ORDER BY name LIMIT 1'),
        one<{ name: string }>(database, 'SELECT name FROM public.product_categories ORDER BY name LIMIT 1'),
      ])

      const product = await json<{ id: string }>(await api.post('/api/pharmacy/products/create', {
        data: {
          generic_name: `Tier2 Local ${suffix}`,
          brand_name: `T2-${suffix}`,
          manufacturer: 'StocMed local verification',
          strength: '10 mg',
          dosage_form: dosageForm.name,
          category: category.name,
          pack_size: '1 blister',
        },
      }))
      expect(product.id).toMatch(/^[0-9a-f-]{36}$/i)

      medication = await json<InventoryItem>(await api.post('/api/pharmacy/drugs', {
        data: {
          item_type: 'medicine',
          product_id: product.id,
          tracks_expiry: true,
          price: 250,
          unit_cost: 100,
          quantity_in_stock: 8,
          low_stock_threshold: 2,
          batch_number: `T2-OPEN-${suffix}`,
          expiry_date: dateDaysFromNow(365),
        },
      }))
      createdInventoryIds.push(medication.id)
      expect(medication).toMatchObject({
        pharmacy_id: profile.id,
        price: 250,
        quantity_in_stock: 8,
      })
      expect(medication.batches).toHaveLength(1)
      originalBatchId = medication.batches[0].id

      const inventoryList = await json<{ drugs: InventoryItem[] }>(
        await api.get('/api/pharmacy/drugs'),
      )
      expect(inventoryList.drugs).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: medication.id })]),
      )

      const persisted = await one<{
        pharmacy_id: string
        quantity_in_stock: number
        opening_count: number
        opening_quantity: number
      }>(database, `
        SELECT inventory.pharmacy_id,
               inventory.quantity_in_stock,
               COUNT(movement.id) FILTER (WHERE movement.type = 'opening')::INTEGER AS opening_count,
               COALESCE(SUM(movement.quantity) FILTER (WHERE movement.type = 'opening'), 0)::INTEGER AS opening_quantity
          FROM public.pharmacy_inventory inventory
          LEFT JOIN public.stock_movements movement ON movement.inventory_id = inventory.id
         WHERE inventory.id = $1
         GROUP BY inventory.id`, [medication.id])
      expect(persisted).toMatchObject({
        pharmacy_id: profile.id,
        quantity_in_stock: 8,
        opening_count: 1,
        opening_quantity: 8,
      })
    })

    await test.step('edit price and create/remove a selling unit with action-scoped authorization', async () => {
      const blockedEdit = await api.patch(`/api/pharmacy/drugs/${medication.id}`, {
        data: { price: 275, low_stock_threshold: 3 },
      })
      await expectJsonFailure(blockedEdit, 403, 'SP_AUTH_REQUIRED')

      priceToken = await authorize(page, 'price_change', 'Tier-2 app-path inventory price test')
      const edited = await json<InventoryItem>(await api.patch(
        `/api/pharmacy/drugs/${medication.id}`,
        {
          headers: { 'x-sp-authorization': priceToken },
          data: { price: 275, low_stock_threshold: 3 },
        },
      ))
      expect(edited).toMatchObject({ price: 275 })

      const sellingUnitPayload = {
        unitName: 'half blister',
        unitsPer: 2,
        price: 300,
        barcode: `UNIT-${randomUUID().slice(0, 8)}`,
      }
      const blockedCreate = await api.post(
        `/api/pharmacy/inventory/${medication.id}/selling-units`,
        { data: sellingUnitPayload },
      )
      await expectJsonFailure(blockedCreate, 403, 'SP_AUTH_REQUIRED')

      const sellingUnit = await json<{ sellingUnit: { id: string } }>(await api.post(
        `/api/pharmacy/inventory/${medication.id}/selling-units`,
        {
          headers: { 'x-sp-authorization': priceToken },
          data: sellingUnitPayload,
        },
      ))
      const blockedDelete = await api.delete(
        `/api/pharmacy/inventory/${medication.id}/selling-units?sellingUnitId=${sellingUnit.sellingUnit.id}`,
      )
      await expectJsonFailure(blockedDelete, 403, 'SP_AUTH_REQUIRED')
      await json<{ success: boolean }>(await api.delete(
        `/api/pharmacy/inventory/${medication.id}/selling-units?sellingUnitId=${sellingUnit.sellingUnit.id}`,
        { headers: { 'x-sp-authorization': priceToken } },
      ))

      const persisted = await one<{ price: string; unit_count: number }>(database, `
        SELECT inventory.price,
               COUNT(selling_unit.id)::INTEGER AS unit_count
          FROM public.pharmacy_inventory inventory
          LEFT JOIN public.selling_units selling_unit ON selling_unit.inventory_id = inventory.id
         WHERE inventory.id = $1
         GROUP BY inventory.id`, [medication.id])
      expect(Number(persisted.price)).toBe(275)
      expect(persisted.unit_count).toBe(0)
    })

    await test.step('create a new batch and restock atomically through the guarded adjustment route', async () => {
      const adjustment = {
        inventory_id: medication.id,
        type: 'Restock',
        quantity: 4,
        reason: 'Tier-2 local app-path restock',
        batch_number: `T2-RESTOCK-${randomUUID().slice(0, 8)}`,
        expiry_date: dateDaysFromNow(540),
        cost_price: 110,
      }
      const blocked = await api.post('/api/pharmacy/inventory/adjust', { data: adjustment })
      await expectJsonFailure(blocked, 403, 'SP_AUTH_REQUIRED')

      stockToken = await authorize(page, 'stock_adjustment', 'Tier-2 app-path new-batch restock')
      const adjusted = await api.post('/api/pharmacy/inventory/adjust', {
        headers: { 'x-sp-authorization': stockToken },
        data: adjustment,
      })
      expect(adjusted.status()).toBe(201)
      await adjusted.dispose()

      const persisted = await one<{
        quantity_in_stock: number
        batch_count: number
        movement_count: number
        movement_quantity: number
      }>(database, `
        SELECT inventory.quantity_in_stock,
               COUNT(DISTINCT batch.id) FILTER (WHERE batch.batch_number = $2)::INTEGER AS batch_count,
               COUNT(DISTINCT movement.id) FILTER (WHERE movement.reason = $3)::INTEGER AS movement_count,
               COALESCE(SUM(DISTINCT movement.quantity) FILTER (WHERE movement.reason = $3), 0)::INTEGER AS movement_quantity
          FROM public.pharmacy_inventory inventory
          LEFT JOIN public.batches batch ON batch.inventory_id = inventory.id
          LEFT JOIN public.stock_movements movement ON movement.inventory_id = inventory.id
         WHERE inventory.id = $1
         GROUP BY inventory.id`, [medication.id, adjustment.batch_number, adjustment.reason])
      expect(persisted).toMatchObject({
        quantity_in_stock: 12,
        batch_count: 1,
        movement_count: 1,
        movement_quantity: 4,
      })
    })

    let importedInventoryId!: string
    await test.step('parse, match, validate, and commit a CSV import through the authenticated app path', async () => {
      const suffix = randomUUID().slice(0, 8)
      const sku = `T2CSV-${suffix}`
      const csv = [
        'Name,Brand,SKU,Price,Quantity,Unit Cost,Item Type,Tracks Expiry',
        `Tier2 CSV ${suffix},Audit Brand,${sku},125,3,60,store,false`,
      ].join('\n')
      const parsed = await json<{ headers: string[]; rows: JsonObject[] }>(
        await api.post('/api/pharmacy/inventory/import/parse', {
          multipart: {
            file: {
              name: 'tier2-local-import.csv',
              mimeType: 'text/csv',
              buffer: Buffer.from(csv),
            },
          },
        }),
      )
      expect(parsed.rows).toHaveLength(1)

      const matched = await json<{ matchedRows: JsonObject[] }>(
        await api.post('/api/pharmacy/inventory/import/match', {
          data: {
            rows: parsed.rows,
            mapping: {
              name: 'Name',
              brand_name: 'Brand',
              sku: 'SKU',
              price: 'Price',
              quantity: 'Quantity',
              unit_cost: 'Unit Cost',
              item_type: 'Item Type',
              tracks_expiry: 'Tracks Expiry',
            },
          },
        }),
      )
      expect(matched.matchedRows).toHaveLength(1)
      expect(matched.matchedRows[0]).toMatchObject({
        mapped: expect.objectContaining({ item_type: 'store', tracks_expiry: false }),
      })

      const validatePayload = {
        import_batch_id: randomUUID(),
        matchedRows: matched.matchedRows,
      }
      expect(await json<{ valid: boolean }>(await api.post(
        '/api/pharmacy/inventory/import/commit',
        { data: { ...validatePayload, validate_only: true } },
      ))).toMatchObject({ valid: true })

      const committed = await api.post('/api/pharmacy/inventory/import/commit', {
        headers: { 'x-sp-authorization': priceToken },
        data: validatePayload,
      })
      expect(await json<{ success: boolean; imported: number; total: number }>(committed)).toMatchObject({
        success: true,
        imported: 1,
        total: 1,
      })

      const imported = await one<{
        id: string
        pharmacy_id: string
        quantity_in_stock: number
        movement_count: number
      }>(database, `
        SELECT inventory.id,
               inventory.pharmacy_id,
               inventory.quantity_in_stock,
               COUNT(movement.id) FILTER (WHERE movement.reference = 'INVENTORY_IMPORT')::INTEGER AS movement_count
          FROM public.pharmacy_inventory inventory
          LEFT JOIN public.stock_movements movement ON movement.inventory_id = inventory.id
         WHERE inventory.pharmacy_id = $1 AND inventory.barcode = $2
         GROUP BY inventory.id`, [profile.id, sku])
      importedInventoryId = imported.id
      createdInventoryIds.push(imported.id)
      expect(imported).toMatchObject({
        pharmacy_id: profile.id,
        quantity_in_stock: 3,
        movement_count: 1,
      })
    })

    let shiftId!: string
    let saleId!: string
    const expectedSaleStock = 10
    await test.step('open a shift and complete an online POS sale with server-authoritative totals', async () => {
      shiftId = randomUUID()
      saleId = randomUUID()
      const openedAt = new Date().toISOString()
      const payload = {
        shifts: [{
          id: shiftId,
          pharmacy_id: profile.id,
          cashier_id: localTenant.user_id,
          opened_at: openedAt,
          opening_float: 0,
          status: 'open',
        }],
        sales: [{
          id: saleId,
          pharmacy_id: profile.id,
          cashier_id: localTenant.user_id,
          shift_id: shiftId,
          subtotal: 1,
          discount: 0,
          total: 1,
          payment_method: 'cash',
          amount_tendered: 600,
          change_due: 50,
          status: 'completed',
          created_at: openedAt,
          items: [{
            inventory_id: medication.id,
            batch_id: originalBatchId,
            quantity: 2,
            unit_price: 1,
            line_total: 2,
          }],
        }],
      }
      const synced = await json<{
        syncedIds: string[]
        syncedShiftIds: string[]
        failedIds: JsonObject[]
        failedShiftIds: JsonObject[]
      }>(await api.post('/api/pharmacy/pos/sync', { data: payload }))
      expect(synced).toMatchObject({
        syncedIds: [saleId],
        syncedShiftIds: [shiftId],
        failedIds: [],
        failedShiftIds: [],
      })

      const persisted = await one<{
        pharmacy_id: string
        cashier_id: string
        shift_id: string
        status: string
        subtotal: string
        total: string
        item_count: number
        item_quantity: number
        sale_movement_count: number
        sale_movement_quantity: number
        quantity_in_stock: number
      }>(database, `
        SELECT sale.pharmacy_id,
               sale.cashier_id,
               sale.shift_id,
               sale.status,
               sale.subtotal,
               sale.total,
               COUNT(DISTINCT item.id)::INTEGER AS item_count,
               COALESCE(SUM(DISTINCT item.quantity), 0)::INTEGER AS item_quantity,
               COUNT(DISTINCT movement.id) FILTER (WHERE movement.reason = 'Sale #' || sale.id::TEXT)::INTEGER AS sale_movement_count,
               COALESCE(SUM(DISTINCT movement.quantity) FILTER (WHERE movement.reason = 'Sale #' || sale.id::TEXT), 0)::INTEGER AS sale_movement_quantity,
               inventory.quantity_in_stock
          FROM public.sales sale
          JOIN public.sale_items item ON item.sale_id = sale.id
          JOIN public.pharmacy_inventory inventory ON inventory.id = item.inventory_id
          LEFT JOIN public.stock_movements movement ON movement.inventory_id = item.inventory_id
         WHERE sale.id = $1
         GROUP BY sale.id, inventory.id`, [saleId])
      expect(persisted).toMatchObject({
        pharmacy_id: profile.id,
        cashier_id: localTenant.user_id,
        shift_id: shiftId,
        status: 'completed',
        item_count: 1,
        item_quantity: 2,
        sale_movement_count: 1,
        sale_movement_quantity: -2,
        quantity_in_stock: expectedSaleStock,
      })
      expect(Number(persisted.subtotal)).toBe(550)
      expect(Number(persisted.total)).toBe(550)

      const replay = await json<{ syncedIds: string[]; failedIds: JsonObject[] }>(
        await api.post('/api/pharmacy/pos/sync', { data: payload }),
      )
      expect(replay).toMatchObject({ syncedIds: [saleId], failedIds: [] })
      const afterReplay = await one<{
        sale_count: number
        item_count: number
        movement_count: number
        quantity_in_stock: number
      }>(database, `
        SELECT (SELECT COUNT(*)::INTEGER FROM public.sales WHERE id = $1) AS sale_count,
               (SELECT COUNT(*)::INTEGER FROM public.sale_items WHERE sale_id = $1) AS item_count,
               (SELECT COUNT(*)::INTEGER FROM public.stock_movements WHERE reason = 'Sale #' || $1::TEXT) AS movement_count,
               (SELECT quantity_in_stock FROM public.pharmacy_inventory WHERE id = $2) AS quantity_in_stock`,
        [saleId, medication.id],
      )
      expect(afterReplay).toEqual({
        sale_count: 1,
        item_count: 1,
        movement_count: 1,
        quantity_in_stock: expectedSaleStock,
      })
    })

    await test.step('enforce separate report and export authorizations while leaving dashboard summary readable', async () => {
      const from = dateDaysFromNow(-1)
      const to = dateDaysFromNow(1)
      const reportQuery = `from=${from}&to=${to}`

      const summary = await api.get(`/api/pharmacy/reports?summary=true&${reportQuery}`)
      expect((await json<{ reports: unknown }>(summary)).reports).toBeTruthy()

      const blockedReport = await api.get(`/api/pharmacy/reports?${reportQuery}`)
      await expectJsonFailure(blockedReport, 403, 'SP_AUTH_REQUIRED')
      const reportToken = await authorize(page, 'financial_reports', 'Tier-2 local report read')
      const report = await api.get(`/api/pharmacy/reports?${reportQuery}`, {
        headers: { 'x-sp-authorization': reportToken },
      })
      expect((await json<{ reports: unknown }>(report)).reports).toBeTruthy()

      const exportPath = `/api/pharmacy/reports/export?format=csv&dataset=sales&${reportQuery}`
      const blockedExport = await api.get(exportPath)
      await expectJsonFailure(blockedExport, 403, 'SP_AUTH_REQUIRED')

      const exportToken = await authorize(page, 'data_export', 'Tier-2 local CSV export')
      const reportTokenMissing = await api.get(exportPath, {
        headers: { 'x-sp-authorization': exportToken },
      })
      await expectJsonFailure(reportTokenMissing, 403, 'SP_REPORT_AUTH_REQUIRED')

      const exported = await api.get(exportPath, {
        headers: {
          'x-sp-authorization': exportToken,
          'x-sp-report-authorization': reportToken,
        },
      })
      expect(exported.status()).toBe(200)
      expect(exported.headers()['content-type']).toContain('text/csv')
      expect(await exported.text()).toContain(saleId)
    })

    await test.step('reverse the completed sale atomically and restore its stock once', async () => {
      const reversalPayload = { kind: 'refund', reason: 'Tier-2 local app-path reversal' }
      const blocked = await api.post(`/api/pharmacy/sales/${saleId}/reverse`, {
        data: reversalPayload,
      })
      await expectJsonFailure(blocked, 403, 'SP_AUTH_REQUIRED')

      const reverseToken = await authorize(page, 'void_or_refund', 'Tier-2 local sale refund')
      const reversed = await json<{ reversal: { success: boolean; status: string } }>(
        await api.post(`/api/pharmacy/sales/${saleId}/reverse`, {
          headers: { 'x-sp-authorization': reverseToken },
          data: reversalPayload,
        }),
      )
      expect(reversed.reversal).toMatchObject({ success: true, status: 'refunded' })

      const persisted = await one<{
        status: string
        return_count: number
        return_quantity: number
        quantity_in_stock: number
      }>(database, `
        SELECT sale.status,
               COUNT(movement.id) FILTER (WHERE movement.reference = 'refund_' || sale.id::TEXT)::INTEGER AS return_count,
               COALESCE(SUM(movement.quantity) FILTER (WHERE movement.reference = 'refund_' || sale.id::TEXT), 0)::INTEGER AS return_quantity,
               inventory.quantity_in_stock
          FROM public.sales sale
          JOIN public.sale_items item ON item.sale_id = sale.id
          JOIN public.pharmacy_inventory inventory ON inventory.id = item.inventory_id
          LEFT JOIN public.stock_movements movement ON movement.inventory_id = inventory.id
         WHERE sale.id = $1
         GROUP BY sale.id, inventory.id`, [saleId])
      expect(persisted).toMatchObject({
        status: 'refunded',
        return_count: 1,
        return_quantity: 2,
        quantity_in_stock: 12,
      })
    })

    await test.step('delist and restore inventory only with the correct action tokens', async () => {
      const blockedDelist = await api.delete(`/api/pharmacy/drugs/${medication.id}`)
      await expectJsonFailure(blockedDelist, 403, 'SP_AUTH_REQUIRED')
      delistToken = await authorize(page, 'delist_inventory', 'Tier-2 local delist')
      expect(await json<{ action: string }>(await api.delete(
        `/api/pharmacy/drugs/${medication.id}`,
        { headers: { 'x-sp-authorization': delistToken } },
      ))).toMatchObject({ action: 'delisted' })

      const blockedRestore = await api.patch(`/api/pharmacy/drugs/${medication.id}/restore`)
      await expectJsonFailure(blockedRestore, 403, 'SP_AUTH_REQUIRED')
      restoreToken = await authorize(page, 'restore_inventory', 'Tier-2 local restore')
      await json<{ id: string }>(await api.patch(
        `/api/pharmacy/drugs/${medication.id}/restore`,
        { headers: { 'x-sp-authorization': restoreToken } },
      ))

      const persisted = await one<{ deleted_at: Date | null; is_listed: boolean }>(
        database,
        'SELECT deleted_at, is_listed FROM public.pharmacy_inventory WHERE id = $1',
        [medication.id],
      )
      expect(persisted).toMatchObject({ deleted_at: null, is_listed: true })
    })

    await test.step('close the test shift, delist disposable fixtures, and restore configuration', async () => {
      const closeShift = await api.post('/api/pharmacy/pos/sync', {
        data: {
          shifts: [{
            id: shiftId,
            pharmacy_id: profile.id,
            cashier_id: localTenant.user_id,
            opened_at: new Date(Date.now() - 60_000).toISOString(),
            opening_float: 0,
            status: 'closed',
            closed_at: new Date().toISOString(),
            counted_cash: 0,
            expected_cash: 0,
            variance: 0,
            notes: 'Tier-2 local audit complete',
          }],
          sales: [],
        },
      })
      expect((await json<{ syncedShiftIds: string[] }>(closeShift)).syncedShiftIds).toContain(shiftId)
      expect((await one<{ status: string }>(
        database,
        'SELECT status FROM public.shifts WHERE id = $1',
        [shiftId],
      )).status).toBe('closed')

      for (const inventoryId of [medication.id, importedInventoryId]) {
        const cleanup = await api.delete(`/api/pharmacy/drugs/${inventoryId}`, {
          headers: { 'x-sp-authorization': delistToken },
        })
        expect(cleanup.ok(), `Could not delist disposable inventory ${inventoryId}`).toBeTruthy()
        await cleanup.dispose()
      }

      const restorationResponses = await restoreConfiguration!()
      for (const response of restorationResponses) {
        expect(
          response.ok(),
          `Configuration restoration failed: ${response.status()} ${await response.text()}`,
        ).toBeTruthy()
        await response.dispose()
      }
      configurationRestored = true

      const restoredProfile = await json<PharmacyProfile>(await api.get('/api/pharmacy/profile'))
      expect(restoredProfile.reservations_enabled).toBe(profile.reservations_enabled)
      const restoredFeatures = await json<{ features: FeatureRow[] }>(
        await api.get('/api/pharmacy/features'),
      )
      expect(restoredFeatures.features).toEqual(expect.arrayContaining([
        expect.objectContaining({
          feature_key: 'packs_and_units',
          is_enabled: originalFeatureState.get('packs_and_units') ?? false,
        }),
        expect.objectContaining({
          feature_key: 'reservations',
          is_enabled: profile.reservations_enabled,
        }),
      ]))
      const restoredSp = await json<SpConfiguration>(await api.get('/api/pharmacy/sp-authorization'))
      expect(restoredSp).toMatchObject({
        configured: originalSp.configured,
        discountThreshold: originalSp.discountThreshold,
        graceMinutes: originalSp.graceMinutes,
        // Removing the last SP code intentionally disables report gating so
        // the pharmacy cannot be locked behind a code that no longer exists.
        requireFinancialReports: originalSp.configured
          ? originalSp.requireFinancialReports
          : false,
      })
    })
  } finally {
    if (!configurationRestored && restoreConfiguration) {
      try {
        const responses = await restoreConfiguration()
        await Promise.all(responses.map((response) => response.dispose()))
      } catch {
        // Preserve the original test failure; a clean local reset restores fixtures.
      }
    }
    await database.end()
  }
})

test('Tier-2 pharmacy profile writes use the authenticated app route and persist authoritatively', async ({
  page,
  baseURL,
}) => {
  expect(baseURL, 'Playwright baseURL is required').toBeTruthy()
  expect(databaseUrl, 'STOCMED_LOCAL_DB_URL is required').toBeTruthy()
  expectLoopbackUrl(baseURL!, 'PLAYWRIGHT_BASE_URL')
  expectLoopbackUrl(databaseUrl!, 'STOCMED_LOCAL_DB_URL')

  const database = new Client({ connectionString: databaseUrl })
  await database.connect()
  try {
    await login(page)
    const api = page.context().request
    const original = await json<PharmacyProfile & { city: string | null; logo_url: string | null }>(
      await api.get('/api/pharmacy/profile'),
    )
    const changedCity = original.city === 'Yaba' ? 'Ikeja' : 'Yaba'

    const updated = await json<PharmacyProfile & { city: string | null; logo_url: string | null }>(
      await api.patch('/api/pharmacy/profile', {
        data: { city: changedCity, logo_url: original.logo_url },
      }),
    )
    expect(updated).toMatchObject({ id: original.id, city: changedCity, logo_url: original.logo_url })
    expect((await one<{ city: string | null; logo_url: string | null }>(
      database,
      'SELECT city, logo_url FROM public.pharmacies WHERE id = $1',
      [original.id],
    ))).toMatchObject({ city: changedCity, logo_url: original.logo_url })

    const restored = await json<PharmacyProfile & { city: string | null }>(
      await api.patch('/api/pharmacy/profile', {
        data: { city: original.city ?? '' },
      }),
    )
    expect(restored.city).toBe(original.city ?? '')
  } finally {
    await database.end()
  }
})
