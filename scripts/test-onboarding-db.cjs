// Isolated contract test. Never accepts a production database URL.
const { Client } = require('pg');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const c = new Client({ host: '127.0.0.1', port: Number(process.env.ONBOARDING_TEST_PORT || 55486), database: 'postgres', user: process.env.USER, connectionTimeoutMillis: 5000 });
const pharmacy = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
(async () => {
  await c.connect();
  await c.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE pharmacies(id uuid PRIMARY KEY, user_id uuid);
    CREATE TABLE dosage_forms(name text PRIMARY KEY);
    CREATE TABLE product_categories(name text PRIMARY KEY);
    INSERT INTO dosage_forms VALUES ('tablet'); INSERT INTO product_categories VALUES ('Analgesics');
    CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generic_name text, brand_name text, manufacturer text, strength text, dosage_form text, category text);
    CREATE TABLE pharmacy_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pharmacy_id uuid, product_id uuid, item_type text, item_name text, brand text, deleted_at timestamptz);
    CREATE FUNCTION create_unverified_catalog_product(uuid,text,text,text,text,text,text,text,text) RETURNS products LANGUAGE plpgsql AS $$
    DECLARE p products; BEGIN INSERT INTO products(generic_name,brand_name,manufacturer,strength,dosage_form,category) VALUES ($2,$3,$4,$5,$6,$7) RETURNING * INTO p; RETURN p; END $$;
    CREATE FUNCTION import_inventory_row(uuid,uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE i uuid; BEGIN IF $4->>'generic_name' = 'Force failure' THEN RAISE EXCEPTION 'Test row failure'; END IF;
    INSERT INTO pharmacy_inventory(pharmacy_id,product_id,item_type,item_name) VALUES ($1,$3::uuid,'medicine',$4->>'source_name') RETURNING id INTO i;
    RETURN jsonb_build_object('success',true,'inventory_id',i); END $$;
  `);
  await c.query(fs.readFileSync('supabase/migrations/20260724020000_safe_catalogue_import_matching.sql', 'utf8').split('CREATE OR REPLACE FUNCTION public.match_catalogue_product_for_import')[0]);
  await c.query(fs.readFileSync('supabase/migrations/20260724040000_verified_import_result.sql', 'utf8').split('-- Prevent older application versions')[0]);
  await c.query(`CREATE FUNCTION import_inventory_file(uuid,uuid,jsonb,uuid,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.import_inventory_file($1,$2,$3,$4) $$; GRANT EXECUTE ON FUNCTION import_inventory_file(uuid,uuid,jsonb,uuid,text) TO authenticated;`);
  for (const file of ['20260926000000_field_stocktake_lookups.sql', '20260926010000_field_stocktake_manufacturer.sql', '20260926020000_saved_pharmacy_onboarding.sql', '20260927000000_structured_product_formulations.sql', '20260927010000_structured_import_engine.sql']) {
    await c.query(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await c.query('INSERT INTO pharmacies VALUES ($1,$2)', [pharmacy, user]);
  await c.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const raw = [4,5,6,7].map(n => ({__row_number:n, name:`Sample ${n}`}));
  const rows = raw.map((r,i) => ({ source_row_number:r.__row_number, selected_product_id:'create_new', review_errors:[], mapped:{
    generic_name: i===3 ? 'Force failure' : `Sample ${i}`, source_name:`Sample ${i}`, manufacturer:'Field manufacturer',
    strength:'500mg', dosage_form:'tablet', category:'Analgesics', price:200, quantity:i===1 ? null : 4,
    batch_number:'B1', expiry_date:i===2 ? '2009-09-30' : '2099-12-31', item_type:'medicine',
  }}));
  const save = async (commit, input=rows) => (await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,$5,null) result', [pharmacy,'test.csv',JSON.stringify(raw),JSON.stringify(input),commit])).rows[0].result;
  let r=await save(false); assert.equal(r.saved,4); assert.equal(r.imported_total,0); assert.equal(r.pending,4);
  r=await save(true); assert.equal(r.imported,1); assert.equal(r.imported_total,1); assert.equal(r.pending,3);
  assert.equal((await c.query('select count(*)::int n from products')).rows[0].n,1, 'failed row product rolled back');
  assert.equal((await c.query('select manufacturer from products')).rows[0].manufacturer,'Field manufacturer');
  r=await save(true); assert.equal(r.imported,0); assert.equal(r.imported_total,1);
  rows[1].mapped.quantity=3; r=await save(true); assert.equal(r.imported,1); assert.equal(r.imported_total,2);
  const anotherRaw=raw.map(r=>({...r,version:2}));
  const again=(await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,true,null) result',[pharmacy,'copy.csv',JSON.stringify(anotherRaw),JSON.stringify(rows)])).rows[0].result;
  assert.equal(again.existing,2); assert.equal(again.imported,0);
  assert.equal((await c.query('select count(*)::int n from pharmacy_inventory')).rows[0].n,2);
  await c.query("select set_config('request.jwt.claim.sub',$1,false)", ['20000000-0000-4000-8000-000000000002']);
  await assert.rejects(save(false), /Not authorized/);
  await c.query('GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON pharmacies TO authenticated; SET ROLE authenticated');
  assert.equal((await c.query('select count(*)::int n from pharmacy_onboarding_batches')).rows[0].n,0, 'RLS hides other tenant batches');
  await c.query('RESET ROLE');
  assert.equal((await c.query("select has_function_privilege('authenticated','import_inventory_file(uuid,uuid,jsonb,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  await c.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const formulation = { kind:'fixed_combination', basis_quantity:1, basis_unit:'tablet', label_confirmed:true,
    ingredients:[{name:'Ingredient B',amount:'125',unit:'mg'},{name:'Ingredient A',amount:'500',unit:'mg'}] };
  const strength = 'Ingredient A 500mg + Ingredient B 125mg per 1 tablet';
  assert.equal((await c.query('select formulation_display($1::jsonb) as value',[JSON.stringify(formulation)])).rows[0].value,strength);
  const multiRaw=[{__row_number:11,name:'Confirmed combination'}];
  const multiRows=[{source_row_number:11,selected_product_id:'create_new',review_errors:[],mapped:{
    generic_name:'Confirmed combination',source_name:'Confirmed combination',strength,formulation,
    dosage_form:'tablet',category:'Analgesics',price:200,quantity:2,batch_number:'C1',expiry_date:'2099-12-31',item_type:'medicine',
  }}];
  const multiSave=async (input=multiRows) => (await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,true,null) result',
    [pharmacy,'combination.csv',JSON.stringify(multiRaw),JSON.stringify(input)])).rows[0].result;
  let multi=await multiSave(); assert.equal(multi.imported,1);
  assert.equal((await c.query('select formulation from products where generic_name=$1',['Confirmed combination'])).rows[0].formulation.kind,'fixed_combination');
  multi=await multiSave(); assert.equal(multi.imported,0);
  const invalidRaw=[{__row_number:12,name:'Incomplete combination'}];
  const invalid=[{...multiRows[0],source_row_number:12,mapped:{...multiRows[0].mapped,generic_name:'Incomplete combination',source_name:'Incomplete combination',formulation:{...formulation,label_confirmed:false}}}];
  const invalidResult=(await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,true,null) result',
    [pharmacy,'incomplete.csv',JSON.stringify(invalidRaw),JSON.stringify(invalid)])).rows[0].result;
  assert.equal(invalidResult.imported,0); assert.equal(invalidResult.pending,1);
  assert.match(invalidResult.rows[0].review_errors.join(' '),/complete labelled formulation/);
  assert.equal((await c.query('select count(*)::int n from products where generic_name=$1',['Incomplete combination'])).rows[0].n,0);
  const productId=(await c.query('select id from products where generic_name=$1',['Confirmed combination'])).rows[0].id;
  const changedRaw=[{__row_number:13,name:'Changed formula'}];
  const changed=[{...multiRows[0],source_row_number:13,selected_product_id:productId,mapped:{
    ...multiRows[0].mapped,generic_name:'Changed formula',source_name:'Changed formula',
    strength:'Ingredient A 250mg + Ingredient B 125mg per 1 tablet',
    formulation:{...formulation,ingredients:[formulation.ingredients[0],{...formulation.ingredients[1],amount:'250'}]},
  }}];
  const changedResult=(await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,true,null) result',
    [pharmacy,'changed.csv',JSON.stringify(changedRaw),JSON.stringify(changed)])).rows[0].result;
  assert.equal(changedResult.imported,0);
  assert.match(changedResult.rows[0].review_errors.join(' '),/Already stocked/);
  await assert.rejects(c.query('select import_inventory_file($1,$2,$3,$4)',
    [pharmacy,user,JSON.stringify(changed),'30000000-0000-4000-8000-000000000013']),/catalogue formulation differs/);
  const missingFormulation=[{...changed[0],mapped:{...changed[0].mapped,formulation:null,strength}}];
  const missingResult=(await c.query('select save_pharmacy_onboarding($1,$2,$3,$4,true,null) result',
    [pharmacy,'changed.csv',JSON.stringify(changedRaw),JSON.stringify(missingFormulation)])).rows[0].result;
  assert.equal(missingResult.imported,0);
  await assert.rejects(c.query('select import_inventory_file($1,$2,$3,$4)',
    [pharmacy,user,JSON.stringify(missingFormulation),'30000000-0000-4000-8000-000000000014']),/catalogue formulation differs/);
  console.log('PASS: migrations, saved rows, partial import, manufacturer, rollback, retries, corrections, duplicates, tenant isolation and private engine permissions');
  await c.end();
})().catch(async e=>{console.error(e);await c.end();process.exitCode=1});
