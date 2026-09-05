#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const PAGE_SIZE = 500
const CHUNK_SIZE = 100

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function chunk(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function sortedById(rows) {
  return [...(rows ?? [])].sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const verificationTarget = process.env.INVENTORY_READ_VERIFY_CONFIRM_PRODUCTION === 'YES'
  ? 'production'
  : process.env.INVENTORY_READ_VERIFY_CONFIRM_NON_PRODUCTION === 'YES'
    ? 'non-production'
    : null

if (!verificationTarget) {
  throw new Error(
    'Refusing to run without INVENTORY_READ_VERIFY_CONFIRM_NON_PRODUCTION=YES or INVENTORY_READ_VERIFY_CONFIRM_PRODUCTION=YES',
  )
}

const supabaseUrl = required('INVENTORY_READ_VERIFY_SUPABASE_URL')
const serviceRoleKey = required('INVENTORY_READ_VERIFY_SERVICE_ROLE_KEY')
const pharmacyId = required('INVENTORY_READ_VERIFY_PHARMACY_ID')
const showDelisted = process.env.INVENTORY_READ_VERIFY_SHOW_DELISTED === 'true'
const expectedMinimumRows = Number(process.env.INVENTORY_READ_VERIFY_MIN_ROWS ?? '1')

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let legacyRequests = 0
const legacyStartedAt = performance.now()
const legacyRows = []
for (let from = 0; ; from += PAGE_SIZE) {
  let query = supabase
    .from('pharmacy_inventory')
    .select('*, products(*), batches(*), selling_units(*)')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)
  if (!showDelisted) query = query.is('deleted_at', null)

  legacyRequests += 1
  const { data, error } = await query
  if (error) throw error
  legacyRows.push(...(data ?? []))
  if (!data || data.length < PAGE_SIZE) break
}

assert.ok(
  legacyRows.length >= expectedMinimumRows,
  `Expected at least ${expectedMinimumRows} inventory rows, received ${legacyRows.length}`,
)

const inventoryIds = legacyRows.map((row) => row.id)
const reservationAvailability = new Map()
const reservedByBatch = new Map()
const movementsByBatch = new Map()

for (const inventoryIdChunk of chunk(inventoryIds, CHUNK_SIZE)) {
  legacyRequests += 1
  const { data: inventoryReservations, error: reservationError } = await supabase.rpc(
    'reservation_sellable_quantities',
    { p_inventory_ids: inventoryIdChunk },
  )
  if (reservationError) throw reservationError
  for (const row of inventoryReservations ?? []) reservationAvailability.set(row.inventory_id, row)

  legacyRequests += 1
  const { data: batchReservations, error: batchReservationError } = await supabase.rpc(
    'reservation_batch_quantities',
    { p_inventory_ids: inventoryIdChunk },
  )
  if (batchReservationError) throw batchReservationError
  for (const row of batchReservations ?? []) {
    reservedByBatch.set(row.batch_id, Number(row.reserved_quantity))
  }
}

for (const inventoryIdChunk of chunk(inventoryIds, CHUNK_SIZE)) {
  legacyRequests += 1
  const { data: movements, error: movementError } = await supabase
    .from('stock_movements')
    .select('batch_id, quantity')
    .in('inventory_id', inventoryIdChunk)
  if (movementError) throw movementError
  for (const movement of movements ?? []) {
    if (!movement.batch_id) continue
    movementsByBatch.set(
      movement.batch_id,
      (movementsByBatch.get(movement.batch_id) ?? 0) + movement.quantity,
    )
  }
}
const legacyElapsedMs = Math.round(performance.now() - legacyStartedAt)

const setBasedStartedAt = performance.now()
const { data: snapshot, error: snapshotError } = await supabase.rpc(
  'get_pharmacy_inventory_enriched',
  { p_pharmacy_id: pharmacyId, p_show_delisted: showDelisted },
)
const setBasedElapsedMs = Math.round(performance.now() - setBasedStartedAt)
if (snapshotError) throw snapshotError

assert.equal(snapshot.length, legacyRows.length, 'row count differs')

const canonicalLegacy = []
const canonicalSetBased = []
for (let index = 0; index < legacyRows.length; index += 1) {
  const legacy = legacyRows[index]
  const current = snapshot[index]
  assert.equal(current.inventory.id, legacy.id, `row ordering differs at index ${index}`)

  const legacyInventory = { ...legacy }
  delete legacyInventory.products
  delete legacyInventory.batches
  delete legacyInventory.selling_units
  assert.deepEqual(current.inventory, legacyInventory, `inventory fields differ for ${legacy.id}`)
  assert.deepEqual(current.product, legacy.products, `product fields differ for ${legacy.id}`)

  const legacyBatches = sortedById(legacy.batches)
  const currentBatches = sortedById(current.batches)
  assert.equal(currentBatches.length, legacyBatches.length, `batch count differs for ${legacy.id}`)
  for (let batchIndex = 0; batchIndex < legacyBatches.length; batchIndex += 1) {
    const legacyBatch = legacyBatches[batchIndex]
    const currentBatch = { ...currentBatches[batchIndex] }
    const ledgerRemaining = Number(currentBatch.__ledger_remaining)
    const reservedQuantity = Number(currentBatch.__reserved_quantity)
    delete currentBatch.__ledger_remaining
    delete currentBatch.__reserved_quantity
    assert.deepEqual(currentBatch, legacyBatch, `batch fields differ for ${legacyBatch.id}`)
    assert.equal(
      ledgerRemaining,
      Number(movementsByBatch.get(legacyBatch.id) ?? legacyBatch.quantity_received),
      `batch ledger differs for ${legacyBatch.id}`,
    )
    assert.equal(
      reservedQuantity,
      Number(reservedByBatch.get(legacyBatch.id) ?? 0),
      `batch reservation differs for ${legacyBatch.id}`,
    )
  }

  assert.deepEqual(
    sortedById(current.selling_units),
    sortedById(legacy.selling_units),
    `selling units differ for ${legacy.id}`,
  )

  const legacyReservation = reservationAvailability.get(legacy.id)
  const expectedReserved = Number(legacyReservation?.reserved_quantity ?? 0)
  const expectedSellable = Number(legacyReservation?.sellable_quantity ?? legacy.quantity_in_stock)
  assert.equal(Number(current.reserved_quantity), expectedReserved, `reserved total differs for ${legacy.id}`)
  assert.equal(Number(current.sellable_quantity), expectedSellable, `sellable total differs for ${legacy.id}`)

  canonicalLegacy.push({
    inventory: legacyInventory,
    product: legacy.products,
    batches: legacyBatches,
    selling_units: sortedById(legacy.selling_units),
    reserved_quantity: expectedReserved,
    sellable_quantity: expectedSellable,
  })
  canonicalSetBased.push({
    inventory: current.inventory,
    product: current.product,
    batches: currentBatches.map(({ __ledger_remaining, __reserved_quantity, ...batch }) => batch),
    selling_units: sortedById(current.selling_units),
    reserved_quantity: Number(current.reserved_quantity),
    sellable_quantity: Number(current.sellable_quantity),
  })
}

assert.deepEqual(canonicalSetBased, canonicalLegacy, 'canonical payload differs')

console.log(JSON.stringify({
  verification_target: verificationTarget,
  rows: snapshot.length,
  payload_equal: true,
  payload_sha256: digest(canonicalSetBased),
  legacy: { requests: legacyRequests, elapsed_ms: legacyElapsedMs },
  set_based: { requests: 1, elapsed_ms: setBasedElapsedMs },
}, null, 2))
