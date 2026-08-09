import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'

const LOCAL_PHARMACY_ID = '30000000-0000-4000-8000-000000000001'
const LOCAL_CASHIER_ID = '10000000-0000-4000-8000-000000000001'
const LOCAL_INVENTORY_ID = '40000000-0000-4000-8000-000000000001'
const LOCAL_PHARMACY_EMAIL = 'pharmacy.test@stocmed.local'
const LOCAL_PHARMACY_NAME = 'StocMed Test Pharmacy'
const PASSWORD = process.env.TEST_PASSWORD || 'StocMedTest123!'

type LocalBatch = {
  id: string
  remaining_qty: number
  expiry_date: string
}

type AppInventoryItem = {
  id: string
  pharmacy_id: string
  brand_name: string | null
  generic_name: string
  price: number
  quantity_in_stock: number
  sellable_quantity: number
  tracks_expiry: boolean
  batches: LocalBatch[]
}

type QueuedSaleItem = {
  inventory_id: string
  batch_id: string | null
  quantity: number
  unit_price: number
  line_total: number
  generic_name: string
  brand_name: string | null
  strength: string
  batch_number: string | null
  expiry_date: string | null
}

type QueuedSale = {
  id: string
  pharmacy_id: string
  cashier_id: string
  shift_id: string
  subtotal: number
  discount: number
  total: number
  payment_method: 'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'other'
  amount_tendered: number | null
  change_due: number | null
  status: 'pending' | 'completed' | 'cancelled'
  created_at: string
  items: QueuedSaleItem[]
  sync_status: 'pending' | 'synced' | 'error'
  sync_error?: string
  retry_count: number
  next_retry_at?: string
}

type LocalShift = {
  id: string
  pharmacy_id: string
  cashier_id: string
  status: 'open' | 'closed'
}

type SyncResponse = {
  success: boolean
  syncedIds: string[]
  failedIds: Array<{ id: string; error: string }>
}

type SaleSnapshot = {
  sale_rows: number
  sale_item_rows: number
  sold_quantity: number
  movement_rows: number
  movement_quantity: number
  shift_rows: number
  pharmacy_rows: number
  pharmacy_id: string | null
  cashier_id: string | null
  shift_id: string | null
  status: string | null
  sale_item_inventory_id: string | null
  sale_item_batch_id: string | null
  movement_inventory_id: string | null
  movement_batch_id: string | null
  movement_created_by: string | null
}

type InventoryFixture = {
  id: string
  pharmacy_id: string
  user_id: string
  pharmacy_name: string
  generic_name: string
  brand_name: string | null
  price: number
  quantity_in_stock: number
  batch_id: string
}

function localPostgresUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    return ['postgres:', 'postgresql:'].includes(url.protocol) && localHost ? raw : null
  } catch {
    return null
  }
}

function isLoopbackHttpUrl(raw: string | undefined): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const LOCAL_DATABASE_URL = localPostgresUrl(process.env.STOCMED_LOCAL_DATABASE_URL)

async function loginThroughUi(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(LOCAL_PHARMACY_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/pharmacy\/dashboard/, { timeout: 30_000 })
}

async function readLocalSales(page: Page): Promise<QueuedSale[]> {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('PosLocalDatabase')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction('local_sales', 'readonly')
        const request = transaction.objectStore('local_sales').getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          db.close()
          resolve(request.result)
        }
      }
    })
  })
}

async function readLocalInventoryItem(page: Page, inventoryId: string): Promise<AppInventoryItem | null> {
  return page.evaluate(async (id) => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('PosLocalDatabase')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction('local_inventory_cache', 'readonly')
        const request = transaction.objectStore('local_inventory_cache').get(id)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          db.close()
          resolve(request.result ?? null)
        }
      }
    })
  }, inventoryId)
}

async function readOpenLocalShift(page: Page): Promise<LocalShift | null> {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('PosLocalDatabase')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction('local_shifts', 'readonly')
        const request = transaction.objectStore('local_shifts').getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          db.close()
          resolve(request.result.find((shift) => shift.status === 'open') ?? null)
        }
      }
    })
  })
}

async function loadFixture(pool: Pool): Promise<InventoryFixture> {
  const result = await pool.query<{
    id: string
    pharmacy_id: string
    user_id: string
    pharmacy_name: string
    generic_name: string
    brand_name: string | null
    price: string
    quantity_in_stock: number
    batch_id: string
  }>(`
    SELECT
      inventory.id,
      inventory.pharmacy_id,
      pharmacy.user_id,
      pharmacy.pharmacy_name,
      product.generic_name,
      product.brand_name,
      inventory.price::text,
      inventory.quantity_in_stock,
      batch.id AS batch_id
    FROM public.pharmacy_inventory inventory
    JOIN public.pharmacies pharmacy ON pharmacy.id = inventory.pharmacy_id
    JOIN public.products product ON product.id = inventory.product_id
    JOIN public.batches batch ON batch.inventory_id = inventory.id
    WHERE inventory.id = $1
      AND batch.expiry_date > CURRENT_DATE
    ORDER BY batch.expiry_date, batch.id
    LIMIT 1
  `, [LOCAL_INVENTORY_ID])
  expect(result.rowCount, 'The clean local seed inventory fixture must exist.').toBe(1)
  const row = result.rows[0]
  return { ...row, price: Number(row.price), quantity_in_stock: Number(row.quantity_in_stock) }
}

async function authoritativeStock(pool: Pool): Promise<number> {
  const result = await pool.query<{ quantity_in_stock: number }>(`
    SELECT quantity_in_stock
    FROM public.pharmacy_inventory
    WHERE id = $1
  `, [LOCAL_INVENTORY_ID])
  expect(result.rowCount).toBe(1)
  return Number(result.rows[0].quantity_in_stock)
}

async function openShiftFromDatabase(pool: Pool): Promise<LocalShift | null> {
  const result = await pool.query<LocalShift>(`
    SELECT id, pharmacy_id, cashier_id, status
    FROM public.shifts
    WHERE pharmacy_id = $1
      AND cashier_id = $2
      AND status = 'open'
    LIMIT 1
  `, [LOCAL_PHARMACY_ID, LOCAL_CASHIER_ID])
  return result.rows[0] ?? null
}

async function saleSnapshot(pool: Pool, saleId: string): Promise<SaleSnapshot> {
  const result = await pool.query<SaleSnapshot>(`
    SELECT
      (SELECT COUNT(*)::int FROM public.sales WHERE id = $1) AS sale_rows,
      (SELECT COUNT(*)::int FROM public.sale_items WHERE sale_id = $1) AS sale_item_rows,
      COALESCE((SELECT SUM(quantity)::int FROM public.sale_items WHERE sale_id = $1), 0) AS sold_quantity,
      (SELECT COUNT(*)::int FROM public.stock_movements WHERE reference = $1::text AND type = 'sale') AS movement_rows,
      COALESCE((SELECT SUM(quantity)::int FROM public.stock_movements WHERE reference = $1::text AND type = 'sale'), 0) AS movement_quantity,
      (SELECT COUNT(*)::int FROM public.shifts WHERE id = (SELECT shift_id FROM public.sales WHERE id = $1 LIMIT 1)) AS shift_rows,
      (SELECT COUNT(*)::int FROM public.pharmacies WHERE id = (SELECT pharmacy_id FROM public.sales WHERE id = $1 LIMIT 1)) AS pharmacy_rows,
      (SELECT pharmacy_id::text FROM public.sales WHERE id = $1 LIMIT 1) AS pharmacy_id,
      (SELECT cashier_id::text FROM public.sales WHERE id = $1 LIMIT 1) AS cashier_id,
      (SELECT shift_id::text FROM public.sales WHERE id = $1 LIMIT 1) AS shift_id,
      (SELECT status FROM public.sales WHERE id = $1 LIMIT 1) AS status,
      (SELECT inventory_id::text FROM public.sale_items WHERE sale_id = $1 LIMIT 1) AS sale_item_inventory_id,
      (SELECT batch_id::text FROM public.sale_items WHERE sale_id = $1 LIMIT 1) AS sale_item_batch_id,
      (SELECT inventory_id::text FROM public.stock_movements WHERE reference = $1::text AND type = 'sale' LIMIT 1) AS movement_inventory_id,
      (SELECT batch_id::text FROM public.stock_movements WHERE reference = $1::text AND type = 'sale' LIMIT 1) AS movement_batch_id,
      (SELECT created_by::text FROM public.stock_movements WHERE reference = $1::text AND type = 'sale' LIMIT 1) AS movement_created_by
  `, [saleId])
  return result.rows[0]
}

async function expectSaleExactlyOnce(pool: Pool, sale: QueuedSale, shiftId: string) {
  await expect.poll(async () => (await saleSnapshot(pool, sale.id)).sale_rows, {
    message: `Sale ${sale.id} was not persisted.`,
    // A development build can overlap the reconnect sync with the 30-second
    // retry timer while compiling routes. Allow the authoritative read to
    // observe the serialized/idempotent transaction after that local-only lag.
    timeout: 120_000,
  }).toBe(1)

  const snapshot = await saleSnapshot(pool, sale.id)
  expect(snapshot).toEqual({
    sale_rows: 1,
    sale_item_rows: 1,
    sold_quantity: sale.items[0].quantity,
    movement_rows: 1,
    movement_quantity: -sale.items[0].quantity,
    shift_rows: 1,
    pharmacy_rows: 1,
    pharmacy_id: LOCAL_PHARMACY_ID,
    cashier_id: LOCAL_CASHIER_ID,
    shift_id: shiftId,
    status: 'completed',
    sale_item_inventory_id: LOCAL_INVENTORY_ID,
    sale_item_batch_id: sale.items[0].batch_id,
    movement_inventory_id: LOCAL_INVENTORY_ID,
    movement_batch_id: sale.items[0].batch_id,
    movement_created_by: LOCAL_CASHIER_ID,
  })
}

async function expectNoPartialWrite(pool: Pool, saleId: string) {
  expect(await saleSnapshot(pool, saleId)).toEqual({
    sale_rows: 0,
    sale_item_rows: 0,
    sold_quantity: 0,
    movement_rows: 0,
    movement_quantity: 0,
    shift_rows: 0,
    pharmacy_rows: 0,
    pharmacy_id: null,
    cashier_id: null,
    shift_id: null,
    status: null,
    sale_item_inventory_id: null,
    sale_item_batch_id: null,
    movement_inventory_id: null,
    movement_batch_id: null,
    movement_created_by: null,
  })
}

async function getInventoryThroughApp(request: APIRequestContext): Promise<AppInventoryItem> {
  const response = await request.get('/api/pharmacy/drugs')
  const text = await response.text()
  expect(response.ok(), `Inventory API failed: ${response.status()} ${text}`).toBeTruthy()
  const body = JSON.parse(text) as { drugs: AppInventoryItem[] }
  const item = body.drugs.find((entry) => entry.id === LOCAL_INVENTORY_ID)
  expect(item, 'The fixed local inventory item was not returned by the authenticated app query.').toBeTruthy()
  return item!
}

async function adjustStockThroughApp(
  request: APIRequestContext,
  fixture: InventoryFixture,
  quantity: number,
  reason: string,
) {
  if (quantity === 0) return
  const response = await request.post(`/api/pharmacy/drugs/${fixture.id}/adjust`, {
    data: {
      type: quantity > 0 ? 'Restock' : 'Adjustment',
      batch_id: fixture.batch_id,
      quantity,
      reason,
    },
  })
  const body = await response.text()
  expect(
    response.ok(),
    `Authenticated stock adjustment failed (${response.status()}): ${body}`,
  ).toBeTruthy()
}

async function restoreStockThroughApp(
  pool: Pool,
  context: BrowserContext,
  fixture: InventoryFixture,
  target: number,
  reason: string,
) {
  await context.setOffline(false)
  const current = await authoritativeStock(pool)
  await adjustStockThroughApp(context.request, fixture, target - current, reason)
  await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(target)
}

async function ensureOpenShift(page: Page, pool: Pool): Promise<LocalShift> {
  await page.goto('/pharmacy/shifts')
  await expect(page.getByRole('heading', { name: 'Shifts & cash' })).toBeVisible()

  let shift = await openShiftFromDatabase(pool)
  if (!shift) {
    await page.getByLabel('Opening float').fill('1000')
    const openButton = page.getByRole('button', { name: 'Open shift', exact: true })
    await expect(openButton).toBeEnabled({ timeout: 30_000 })
    await openButton.click()
    await expect(page.getByText('Expected cash')).toBeVisible()
    await expect.poll(() => openShiftFromDatabase(pool), { timeout: 20_000 }).not.toBeNull()
    shift = await openShiftFromDatabase(pool)
  }

  expect(shift).toMatchObject({
    pharmacy_id: LOCAL_PHARMACY_ID,
    cashier_id: LOCAL_CASHIER_ID,
    status: 'open',
  })

  await expect.poll(async () => (await readOpenLocalShift(page))?.id, {
    message: 'The authenticated Shifts page did not hydrate the open server shift into Dexie.',
    timeout: 120_000,
  }).toBe(shift!.id)
  const localShift = await readOpenLocalShift(page)
  expect(localShift).toMatchObject(shift!)
  return shift!
}

async function openPos(page: Page, shiftId: string): Promise<AppInventoryItem> {
  await page.goto('/pharmacy/pos')
  await expect(page.getByRole('heading', { name: 'StocMed POS' })).toBeVisible()
  await expect(page.getByText(LOCAL_PHARMACY_NAME, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Shift open/ })).toBeVisible()
  await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible()
  await expect.poll(async () => (await readOpenLocalShift(page))?.id, { timeout: 20_000 }).toBe(shiftId)
  await expect.poll(async () => (await readLocalInventoryItem(page, LOCAL_INVENTORY_ID))?.id, {
    timeout: 20_000,
  }).toBe(LOCAL_INVENTORY_ID)
  return (await readLocalInventoryItem(page, LOCAL_INVENTORY_ID))!
}

function itemLabel(item: Pick<AppInventoryItem, 'brand_name' | 'generic_name'>) {
  return item.brand_name || item.generic_name
}

function inventorySearchResult(page: Page, label: string) {
  return page.locator('button')
    .filter({ hasText: label })
    .filter({ hasText: /(?:\d+ units|Out)/ })
    .first()
}

async function expectDisplayedStock(page: Page, label: string, expected: number) {
  const search = page.getByPlaceholder('Scan barcode or type an item name...')
  await search.fill(label)
  const card = inventorySearchResult(page, label)
  await expect(card).toBeVisible()
  await expect(card).toContainText(expected === 0 ? 'Out' : `${expected} units`)
  await search.fill('')
}

async function queueOneOfflineSale(page: Page, inventory: AppInventoryItem): Promise<QueuedSale> {
  const before = await readLocalSales(page)
  const beforeIds = new Set(before.map((sale) => sale.id))
  const label = itemLabel(inventory)
  const search = page.getByPlaceholder('Scan barcode or type an item name...')
  await search.fill(label)
  await inventorySearchResult(page, label).click()
  await page.getByRole('button', { name: /^Checkout/ }).click()
  await page.getByRole('button', { name: /Transfer/ }).click()
  await page.getByRole('button', { name: 'Save Offline' }).click()

  await expect(page.getByRole('heading', { name: 'Sale Complete!' })).toBeVisible()
  await expect(page.getByText('Saved offline — will sync automatically')).toBeVisible()
  await expect.poll(async () => (await readLocalSales(page)).length, { timeout: 10_000 }).toBe(before.length + 1)

  const sale = (await readLocalSales(page)).find((entry) => !beforeIds.has(entry.id))
  expect(sale).toMatchObject({
    pharmacy_id: LOCAL_PHARMACY_ID,
    cashier_id: LOCAL_CASHIER_ID,
    sync_status: 'pending',
    retry_count: 0,
  })
  expect(sale!.items).toHaveLength(1)
  expect(sale!.items[0]).toMatchObject({ inventory_id: LOCAL_INVENTORY_ID, quantity: 1 })

  await page.getByRole('button', { name: 'New Sale' }).click()
  return sale!
}

async function waitForReconnectSync(page: Page, context: BrowserContext, saleIds: string[]) {
  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().includes('/api/pharmacy/pos/sync') || response.request().method() !== 'POST') return false
    const body = response.request().postDataJSON() as { sales?: Array<{ id?: string }> } | null
    const sentIds = new Set((body?.sales ?? []).map((sale) => sale.id))
    return saleIds.every((id) => sentIds.has(id))
  }, { timeout: 120_000 })
  await context.setOffline(false)
  const response = await responsePromise
  expect(response.ok()).toBeTruthy()
  return await response.json() as SyncResponse
}

async function expectLocalStatuses(page: Page, expected: Map<string, QueuedSale['sync_status']>) {
  await expect.poll(async () => {
    const sales = await readLocalSales(page)
    return [...expected].map(([id]) => sales.find((sale) => sale.id === id)?.sync_status ?? null)
  }, { timeout: 20_000 }).toEqual([...expected.values()])
}

function buildOnlineSale(
  inventory: AppInventoryItem,
  shiftId: string,
  quantity: number,
): QueuedSale {
  let remaining = quantity
  const items: QueuedSaleItem[] = []
  for (const batch of inventory.batches) {
    if (remaining === 0) break
    const allocated = Math.min(remaining, Number(batch.remaining_qty))
    if (allocated <= 0) continue
    items.push({
      inventory_id: inventory.id,
      batch_id: batch.id,
      quantity: allocated,
      unit_price: Number(inventory.price),
      line_total: allocated * Number(inventory.price),
      generic_name: inventory.generic_name,
      brand_name: inventory.brand_name,
      strength: '',
      batch_number: null,
      expiry_date: batch.expiry_date,
    })
    remaining -= allocated
  }
  expect(remaining, 'The authenticated inventory response must expose enough batch stock.').toBe(0)
  const subtotal = quantity * Number(inventory.price)
  return {
    id: randomUUID(),
    pharmacy_id: LOCAL_PHARMACY_ID,
    cashier_id: LOCAL_CASHIER_ID,
    shift_id: shiftId,
    subtotal,
    discount: 0,
    total: subtotal,
    payment_method: 'bank_transfer',
    amount_tendered: null,
    change_due: null,
    status: 'completed',
    created_at: new Date().toISOString(),
    items,
    sync_status: 'pending',
    retry_count: 0,
  }
}

async function syncThroughAuthenticatedApp(request: APIRequestContext, sales: QueuedSale[]) {
  const response = await request.post('/api/pharmacy/pos/sync', { data: { shifts: [], sales } })
  const text = await response.text()
  expect(response.ok(), `POS sync route failed (${response.status()}): ${text}`).toBeTruthy()
  const body = JSON.parse(text) as SyncResponse
  expect(body.success).toBe(true)
  return body
}

test.describe('tablet offline POS authoritative reconnect', () => {
  // Production allows the hosted auth endpoint in CSP. This loopback-only
  // suite bypasses CSP so the browser can reach the real local Supabase port.
  test.use({ bypassCSP: true })
  test.skip(
    !LOCAL_DATABASE_URL,
    'Set STOCMED_LOCAL_DATABASE_URL to a loopback PostgreSQL URL. Non-local and implicit URLs are refused.',
  )

  let pool: Pool

  test.beforeAll(() => {
    pool = new Pool({ connectionString: LOCAL_DATABASE_URL!, max: 2 })
  })

  test.afterAll(async () => {
    await pool?.end()
  })

  test.beforeEach(async ({ baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', 'This is the i2M tablet-path project.')
    test.skip(!isLoopbackHttpUrl(baseURL), 'This destructive fixture is restricted to a loopback app URL.')
  })

  test('Test 1: queues three real Dexie sales offline and syncs each exactly once', async ({ page, context }) => {
    await loginThroughUi(page)
    const fixture = await loadFixture(pool)
    expect(fixture).toMatchObject({
      id: LOCAL_INVENTORY_ID,
      pharmacy_id: LOCAL_PHARMACY_ID,
      user_id: LOCAL_CASHIER_ID,
      pharmacy_name: LOCAL_PHARMACY_NAME,
    })
    const initialStock = await authoritativeStock(pool)

    try {
      if (initialStock < 6) {
        await adjustStockThroughApp(context.request, fixture, 6 - initialStock, 'Offline POS E2E Test 1 setup')
      }
      const workingStock = await authoritativeStock(pool)
      const shift = await ensureOpenShift(page, pool)
      const inventory = await openPos(page, shift.id)
      expect(inventory.quantity_in_stock).toBe(workingStock)

      await context.setOffline(true)
      await expect(page.getByText('Offline — sales saved')).toBeVisible()
      const sales = [
        await queueOneOfflineSale(page, inventory),
        await queueOneOfflineSale(page, inventory),
        await queueOneOfflineSale(page, inventory),
      ]
      await expect.poll(async () => (await readLocalSales(page)).filter((sale) => sale.sync_status === 'pending').length)
        .toBe(3)
      expect((await readLocalInventoryItem(page, fixture.id))?.quantity_in_stock).toBe(workingStock - 3)

      const sync = await waitForReconnectSync(page, context, sales.map((sale) => sale.id))
      expect(new Set(sync.syncedIds)).toEqual(new Set(sales.map((sale) => sale.id)))
      expect(sync.failedIds).toEqual([])
      await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible()
      await expectLocalStatuses(page, new Map(sales.map((sale) => [sale.id, 'synced'])))

      for (const sale of sales) await expectSaleExactlyOnce(pool, sale, shift.id)
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(workingStock - 3)
      await expectDisplayedStock(page, itemLabel(inventory), workingStock - 3)
      expect((await readLocalInventoryItem(page, fixture.id))?.quantity_in_stock).toBe(workingStock - 3)
    } finally {
      await restoreStockThroughApp(pool, context, fixture, initialStock, 'Offline POS E2E Test 1 cleanup')
    }
  })

  test('Test 2: replaying the same offline UUID cannot duplicate rows or decrement stock twice', async ({ page, context }) => {
    await loginThroughUi(page)
    const fixture = await loadFixture(pool)
    const initialStock = await authoritativeStock(pool)

    try {
      if (initialStock < 2) {
        await adjustStockThroughApp(context.request, fixture, 2 - initialStock, 'Offline POS E2E Test 2 setup')
      }
      const workingStock = await authoritativeStock(pool)
      const shift = await ensureOpenShift(page, pool)
      const inventory = await openPos(page, shift.id)
      await context.setOffline(true)
      await expect(page.getByText('Offline — sales saved')).toBeVisible()
      const sale = await queueOneOfflineSale(page, inventory)

      const firstSync = await waitForReconnectSync(page, context, [sale.id])
      expect(firstSync.syncedIds).toContain(sale.id)
      expect(firstSync.failedIds).toEqual([])
      await expectSaleExactlyOnce(pool, sale, shift.id)
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(workingStock - 1)

      const firstReplay = await syncThroughAuthenticatedApp(context.request, [sale])
      const secondReplay = await syncThroughAuthenticatedApp(context.request, [sale])
      expect(firstReplay.syncedIds).toContain(sale.id)
      expect(secondReplay.syncedIds).toContain(sale.id)

      await expectSaleExactlyOnce(pool, sale, shift.id)
      expect(await authoritativeStock(pool)).toBe(workingStock - 1)
      await expectLocalStatuses(page, new Map([[sale.id, 'synced']]))
      await expectDisplayedStock(page, itemLabel(inventory), workingStock - 1)
    } finally {
      await restoreStockThroughApp(pool, context, fixture, initialStock, 'Offline POS E2E Test 2 cleanup')
    }
  })

  test('Test 3: a mid-batch stock conflict preserves successes and retries the failed sale atomically', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await loginThroughUi(page)
    const fixture = await loadFixture(pool)
    const initialStock = await authoritativeStock(pool)
    let onlineContext: BrowserContext | null = null

    try {
      if (initialStock < 8) {
        await adjustStockThroughApp(context.request, fixture, 8 - initialStock, 'Offline POS E2E Test 3 setup')
      }
      const workingStock = await authoritativeStock(pool)
      expect(workingStock).toBeGreaterThanOrEqual(8)

      const shift = await ensureOpenShift(page, pool)
      const inventory = await openPos(page, shift.id)
      expect(inventory.quantity_in_stock).toBe(workingStock)

      await context.setOffline(true)
      await expect(page.getByText('Offline — sales saved')).toBeVisible()
      const queued = [
        await queueOneOfflineSale(page, inventory),
        await queueOneOfflineSale(page, inventory),
        await queueOneOfflineSale(page, inventory),
      ]

      onlineContext = await browser.newContext({
        baseURL,
        bypassCSP: true,
        viewport: { width: 1024, height: 768 },
      })
      const onlinePage = await onlineContext.newPage()
      await loginThroughUi(onlinePage)
      const authoritativeInventory = await getInventoryThroughApp(onlineContext.request)
      expect(authoritativeInventory.quantity_in_stock).toBe(workingStock)

      // Leave exactly two units on the server. The first two queued sales can
      // commit; the third must fail inside its own database transaction.
      const competingSale = buildOnlineSale(authoritativeInventory, shift.id, workingStock - 2)
      const competingSync = await syncThroughAuthenticatedApp(onlineContext.request, [competingSale])
      expect(competingSync.syncedIds).toEqual([competingSale.id])
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(2)

      const reconnect = await waitForReconnectSync(page, context, queued.map((sale) => sale.id))
      expect(reconnect.syncedIds).toHaveLength(2)
      expect(reconnect.failedIds).toHaveLength(1)
      const syncedIds = new Set(reconnect.syncedIds)
      const failedId = reconnect.failedIds[0].id
      const failedSale = queued.find((sale) => sale.id === failedId)
      expect(failedSale, 'The server failure must identify one of the exact queued Dexie sales.').toBeTruthy()
      expect(reconnect.failedIds[0].error).toMatch(/insufficient (?:sellable )?stock/i)
      expect(queued.filter((sale) => syncedIds.has(sale.id))).toHaveLength(2)

      await expect(page.getByText('1 failed', { exact: true })).toBeVisible()
      await expectLocalStatuses(page, new Map(queued.map((sale) => [
        sale.id,
        sale.id === failedId ? 'pending' : 'synced',
      ])))
      const localFailure = (await readLocalSales(page)).find((sale) => sale.id === failedId)
      expect(localFailure).toMatchObject({ sync_status: 'pending', retry_count: 1 })
      expect(localFailure?.sync_error).toMatch(/insufficient (?:sellable )?stock/i)
      expect(localFailure?.next_retry_at).toBeTruthy()

      for (const sale of queued.filter((entry) => syncedIds.has(entry.id))) {
        await expectSaleExactlyOnce(pool, sale, shift.id)
      }
      await expectNoPartialWrite(pool, failedId)
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(0)
      await expectDisplayedStock(page, itemLabel(inventory), 0)
      expect((await readLocalInventoryItem(page, fixture.id))?.quantity_in_stock).toBe(0)

      await adjustStockThroughApp(
        onlineContext.request,
        fixture,
        1,
        `Offline POS E2E retry stock for ${failedId}`,
      )
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(1)

      const retryResponse = page.waitForResponse((response) => {
        if (!response.url().includes('/api/pharmacy/pos/sync') || response.request().method() !== 'POST') return false
        const body = response.request().postDataJSON() as { sales?: Array<{ id?: string }> } | null
        return (body?.sales ?? []).some((sale) => sale.id === failedId)
      }, { timeout: 30_000 })
      await page.getByRole('button', { name: 'Retry' }).click()
      const retry = await retryResponse
      expect(retry.ok()).toBeTruthy()
      const retryRequest = retry.request().postDataJSON() as { sales?: Array<{ id?: string }> }
      expect((retryRequest.sales ?? []).map((sale) => sale.id)).toEqual([failedId])
      const retryBody = await retry.json() as SyncResponse
      expect(retryBody.syncedIds).toEqual([failedId])
      expect(retryBody.failedIds).toEqual([])

      await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible()
      await expectLocalStatuses(page, new Map(queued.map((sale) => [sale.id, 'synced'])))
      for (const sale of queued) await expectSaleExactlyOnce(pool, sale, shift.id)
      await expect.poll(() => authoritativeStock(pool), { timeout: 20_000 }).toBe(0)
      await expectDisplayedStock(page, itemLabel(inventory), 0)
      expect((await readLocalInventoryItem(page, fixture.id))?.quantity_in_stock).toBe(0)
    } finally {
      await onlineContext?.close()
      await restoreStockThroughApp(pool, context, fixture, initialStock, 'Offline POS E2E Test 3 cleanup')
    }
  })
})
