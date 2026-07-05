const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    envVars[match[1]] = value;
  }
});

const supabase = createClient(envVars['NEXT_PUBLIC_SUPABASE_URL'], envVars['SUPABASE_SERVICE_ROLE_KEY']);

async function getColumns(tableName) {
  // We can query the information_schema or perform a query that returns columns or check the select response keys
  // Since we cannot run raw sql unless we define an RPC, we can query metadata or we can select a single row
  // and see the keys, but that doesn't show types or constraints.
  // Wait, does Supabase have a way? Yes, we can query information_schema.columns through PostgREST?
  // No, PostgREST doesn't expose information_schema by default unless configured or via a custom RPC/function.
  // Wait! Let's check if we have any RPC or if we can define a temporary database function using the service_role key?
  // Wait, Supabase client cannot run arbitrary SQL statements directly, unless we have a postgres client.
  // Wait, does pg connection work if we use an IPv4 proxy or connection pooler?
  // Let's look at .env.local:
  // DATABASE_URL="postgresql://postgres:_Y2u%252HCa5Pw2tz@db.iesbktqljjseiryeqbjn.supabase.co:5432/postgres"
  // Wait, is there a session pooler or transaction pooler?
  // Let's check if we can connect to the database via IPv4.
  // Supabase hosts also support pg connection via IPv4 on port 6543 (transaction pooler) or using supabase's pooler.
  // Let's check `test_ipv6.js` and `test_pooler.js` in the artifacts to see if there was a pooler or what was tested!
}

async function main() {
  console.log('Fetching sample rows to inspect keys:');
  const tables = ['users', 'pharmacies', 'products', 'pharmacy_inventory', 'batches', 'stock_movements', 'sales', 'sale_items', 'searches', 'chat_messages'];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table ${table} error:`, error.message);
    } else {
      console.log(`Table ${table} sample keys:`, data.length > 0 ? Object.keys(data[0]) : '(empty table)');
      if (data.length > 0) {
        console.log(`  Sample row:`, data[0]);
      }
    }
  }
}

main();
