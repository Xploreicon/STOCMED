import { expect, test, type Page } from '@playwright/test'

const uploadPath = '/api/reservations/prescription'
const inventoryId = '00000000-0000-4000-8000-000000000001'
const pharmacy = {
  pharmacy_name: 'Fixture Pharmacy',
  address: 'Fixture address',
  city: 'Yaba',
  state: 'Lagos',
  phone: '',
  is_verified: true,
  verification_status: 'full',
  reservations_enabled: true,
  digital_prescription_reservations_enabled: true,
}
const inventory = {
  id: inventoryId,
  name: 'Fixture Medicine',
  brand_name: 'Fixture Medicine',
  generic_name: 'Fixture Ingredient',
  strength: '10 mg',
  quantity_in_stock: 10,
  requires_prescription: true,
  price: 500,
  pharmacies: pharmacy,
}

async function openPrescriptionForm(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  expect(['127.0.0.1', 'localhost']).toContain(new URL(origin).hostname)
  await page.context().addCookies([{ url: origin, name: 'fixture-web-session', value: 'synthetic' }])
  await page.route(url => url.origin !== origin, route => route.abort('blockedbyclient'))
  await page.route('**/api/drugs/search?*', route => route.fulfill({ json: { results: [inventory] } }))
  await page.route(`**${uploadPath}`, route => route.fulfill({ status: 201, json: { submission: { id: 'fixture' } } }))
  await page.goto('/search-results?q=Fixture+Medicine&location=Yaba')
  await page.getByText(inventory.name, { exact: true }).click()
  await expect(page.getByRole('heading', { name: pharmacy.pharmacy_name })).toBeVisible()
}

async function sendPrescription(page: Page) {
  await page.getByLabel('Exact quantity').fill('2')
  const request = page.waitForRequest(request =>
    new URL(request.url()).pathname === uploadPath && request.method() === 'POST')
  await page.getByRole('button', { name: 'Reserve with prescription', exact: true }).click()
  const posted = await request
  await expect(page.getByText(/Prescription submitted for licensed pharmacist pre-review/)).toBeVisible()
  const headers = await posted.allHeaders()
  expect(headers.authorization).toBeUndefined()
  expect(headers.cookie).toContain('fixture-web-session=synthetic')
  expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
  const upload = posted.postDataBuffer()!
  expect(upload.includes(`name="inventory_id"\r\n\r\n${inventoryId}`)).toBe(true)
  expect(upload.includes('name="quantity"\r\n\r\n2')).toBe(true)
  return upload
}

test('web prescription upload preserves the original PDF bytes', async ({ page, baseURL }) => {
  await openPrescriptionForm(page, baseURL!)
  const pdf = Buffer.from('%PDF-1.4\nSynthetic browser fixture only')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'fixture.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  })

  const upload = await sendPrescription(page)
  expect(upload.includes('filename="fixture.pdf"')).toBe(true)
  expect(upload.includes(pdf)).toBe(true)
})

test('web prescription upload previews the reduced and upright JPEG and strips EXIF', async ({ page, baseURL }) => {
  await openPrescriptionForm(page, baseURL!)
  const encoded = await page.evaluate(() => {
    const source = document.createElement('canvas')
    source.width = 3200
    source.height = 1600
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.fillStyle = '#e00000'
    ctx.fillRect(0, 0, 1000, 600)
    return source.toDataURL('image/jpeg').split(',')[1]
  })
  const jpeg = Buffer.from(encoded, 'base64')
  // Little-endian TIFF with Orientation = 6 (rotate 90 degrees clockwise).
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex')
  const app1 = Buffer.from([0xff, 0xe1, 0, 0])
  app1.writeUInt16BE(exif.length + 2, 2)
  const photo = Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)])
  await page.locator('input[type="file"]').setInputFiles({
    name: 'rotated-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  })
  const preview = page.getByRole('img', { name: 'Prepared prescription preview' })
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate(image => {
    const photo = image as HTMLImageElement
    return [photo.naturalWidth, photo.naturalHeight]
  })).toEqual([1280, 2560])

  const upload = await sendPrescription(page)
  expect(upload.includes('filename="prescription.jpg"')).toBe(true)
  expect(upload.includes('Exif')).toBe(false)
  expect(upload.includes('rotated-photo.jpg')).toBe(false)
  expect(upload.length).toBeLessThan(photo.length)
})
