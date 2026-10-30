import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const source = new URL(process.env.PROCUREMENT_TEST_DATABASE_URL || 'postgresql://localhost:55492/postgres')
if (!['localhost','127.0.0.1','[::1]'].includes(source.hostname)) throw new Error('Procurement tests require a disposable local PostgreSQL server')
const database = `procurement_test_${randomUUID().replaceAll('-','')}`
const admin = new pg.Client({ connectionString: source.href })
await admin.connect()
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const extract = (text, name) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  if (start < 0) throw new Error(`Missing source function ${name}`)
  const end = text.indexOf('\n$$;',start)
  return text.slice(start,end+4)
}
let client
try {
  await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$")
  await admin.query(`CREATE DATABASE ${database}`)
  source.pathname = `/${database}`
  client = new pg.Client({ connectionString: source.href })
  client.on('notice', notice => { if (notice.message.startsWith('PASS')) console.log(notice.message) })
  await client.connect()
  await client.query(await read('tests/database/procurement-fixture.sql'))
  const staff = await read('supabase/migrations/20260822050000_staff_accounts_available.sql')
  await client.query(staff.slice(staff.indexOf('CREATE TABLE IF NOT EXISTS public.pharmacy_staff ('),staff.indexOf('ALTER TABLE public.sales ADD COLUMN')))
  await client.query(extract(staff,'authorize_staff_permission'))
  await client.query(extract(await read('supabase/migrations/20260724010000_two_department_inventory.sql'),'create_purchase_order'))
  await client.query(await read('supabase/migrations/20261025132235_inventory_recovery_bin.sql'))
  await client.query(await read('supabase/migrations/20261031010000_procurement_flow_fixes.sql'))
  await client.query(await read('tests/database/procurement-flows.sql'))
  // Two independent connections submit the same delivery at once.
  await client.query(`INSERT INTO pharmacy_staff(id,pharmacy_id,name,role,pin_hash,permissions)
    VALUES('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Concurrent receiver','pharmacist','unused','{"can_adjust_stock":true,"can_change_prices":true}')`)
  await client.query(`INSERT INTO pharmacy_staff_sessions(pharmacy_id,staff_id,token_hash,expires_at)
    VALUES('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',encode(extensions.digest('concurrent-token','sha256'),'hex'),NOW()+INTERVAL '1 day')`)
  const command = { action: 'receive', supplier_id: '30000000-0000-4000-8000-000000000001', request_key: randomUUID(),
    lines: [{ product_id: '40000000-0000-4000-8000-000000000001', quantity_received: 2, unit_cost: 120, selling_price: 200, batch_number: 'CONCURRENT', expiry_date: '2099-12-31' }] }
  const connections = [new pg.Client({ connectionString: source.href }),new pg.Client({ connectionString: source.href })]
  try {
    await Promise.all(connections.map(async connection => {
      await connection.connect()
      await connection.query("SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',FALSE)")
    }))
    const results = await Promise.all(connections.map(connection => connection.query(
      "SELECT write_procurement('10000000-0000-4000-8000-000000000001',$1,'concurrent-token',$2) result",
      [command,{ price_change: 'approved-price_change' }],
    )))
    const { rows } = await client.query('SELECT (SELECT count(*) FROM goods_receipts) receipts,(SELECT sum(quantity) FROM stock_movements) units')
    if (Number(rows[0].receipts) !== 1 || Number(rows[0].units) !== 2 || results[0].rows[0].result.receipt_id !== results[1].rows[0].result.receipt_id) throw new Error('Concurrent receipt retry duplicated stock')
    console.log('PASS concurrent receipt retries produce one receipt and one stock entry')
  } finally { await Promise.all(connections.map(connection => connection.end())) }
  console.log('Procurement database regression checks passed')
} finally {
  await client?.end()
  await admin.query(`DROP DATABASE IF EXISTS ${database}`)
  await admin.end()
}
