import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.TEST_PASSWORD || 'StocMedTest123!'

if (!url || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureAuthUser(email, metadata) {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw listError
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    })
    if (error) throw error
    return data.user
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error) throw error
  return data.user
}

async function upsertProfile(user, profile) {
  const { error } = await supabase.from('users').upsert({
    user_id: user.id,
    email: user.email,
    ...profile,
  }, { onConflict: 'user_id' })
  if (error) throw error
}

const pharmacyUser = await ensureAuthUser('pharmacy.test@stocmed.local', {
  role: 'pharmacy',
  full_name: 'Test Cashier',
})
await upsertProfile(pharmacyUser, {
  full_name: 'Test Cashier',
  phone: '08000000001',
  role: 'pharmacy',
  is_admin: false,
  is_licensed_pharmacist: true,
})

const pharmacyPayload = {
  user_id: pharmacyUser.id,
  pharmacy_name: 'StocMed Test Pharmacy',
  license_number: 'PCN-TEST-001',
  address: '1 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08000000001',
  is_verified: true,
  is_active: true,
}
const { data: pharmacyRows, error: pharmacyLookupError } = await supabase
  .from('pharmacies')
  .select('id')
  .eq('user_id', pharmacyUser.id)
  .limit(1)
if (pharmacyLookupError) throw pharmacyLookupError
if (pharmacyRows.length) {
  const { error } = await supabase.from('pharmacies').update(pharmacyPayload).eq('id', pharmacyRows[0].id)
  if (error) throw error
} else {
  const { error } = await supabase.from('pharmacies').insert(pharmacyPayload)
  if (error) throw error
}

const { data: seedProduct, error: productError } = await supabase
  .from('products')
  .select('id')
  .not('barcode', 'is', null)
  .limit(1)
  .single()
if (productError) throw productError

const { data: seededInventory, error: inventoryError } = await supabase
  .from('pharmacy_inventory')
  .upsert({
    pharmacy_id: pharmacyRows[0]?.id || undefined,
    product_id: seedProduct.id,
    price: 1500,
    low_stock_threshold: 10,
    is_listed: true,
  }, { onConflict: 'pharmacy_id,product_id' })
  .select('id, pharmacy_id')
  .single()
if (inventoryError) {
  const { data: pharmacy } = await supabase.from('pharmacies').select('id').eq('user_id', pharmacyUser.id).single()
  const { data, error } = await supabase.from('pharmacy_inventory').upsert({
    pharmacy_id: pharmacy.id,
    product_id: seedProduct.id,
    price: 1500,
    low_stock_threshold: 10,
    is_listed: true,
  }, { onConflict: 'pharmacy_id,product_id' }).select('id, pharmacy_id').single()
  if (error) throw error
  Object.assign(seededInventory || {}, data)
}

const inventoryId = seededInventory?.id || (await supabase
  .from('pharmacy_inventory')
  .select('id')
  .eq('product_id', seedProduct.id)
  .eq('pharmacy_id', (await supabase.from('pharmacies').select('id').eq('user_id', pharmacyUser.id).single()).data.id)
  .single()).data.id
const { data: existingBatch, error: batchLookupError } = await supabase
  .from('batches')
  .select('id')
  .eq('inventory_id', inventoryId)
  .eq('batch_number', 'HOSTED-TEST-01')
  .limit(1)
if (batchLookupError) throw batchLookupError
let batchId = existingBatch[0]?.id
if (!batchId) {
  const expiry = new Date()
  expiry.setFullYear(expiry.getFullYear() + 1)
  const { data, error } = await supabase.from('batches').insert({
    inventory_id: inventoryId,
    batch_number: 'HOSTED-TEST-01',
    expiry_date: expiry.toISOString().slice(0, 10),
    quantity_received: 25,
    cost_price: 900,
    received_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw error
  batchId = data.id
}
const { count: movementCount, error: movementLookupError } = await supabase
  .from('stock_movements')
  .select('id', { count: 'exact', head: true })
  .eq('reference', 'HOSTED-TEST-SEED')
  .eq('inventory_id', inventoryId)
if (movementLookupError) throw movementLookupError
if (!movementCount) {
  const { error } = await supabase.from('stock_movements').insert({
    inventory_id: inventoryId,
    batch_id: batchId,
    type: 'opening',
    quantity: 25,
    reason: 'Hosted responsive-test fixture',
    reference: 'HOSTED-TEST-SEED',
    created_by: pharmacyUser.id,
  })
  if (error) throw error
}

const patientUser = await ensureAuthUser('patient.test@stocmed.local', {
  role: 'patient',
  full_name: 'Test Patient',
})
await upsertProfile(patientUser, {
  full_name: 'Test Patient',
  phone: '08000000003',
  role: 'patient',
  location: 'Lagos',
  is_admin: false,
  is_licensed_pharmacist: false,
})

console.log(JSON.stringify({
  pharmacy: { id: pharmacyUser.id, email: pharmacyUser.email },
  patient: { id: patientUser.id, email: patientUser.email },
}))
