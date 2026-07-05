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
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    envVars[match[1]] = value;
  }
});

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envVars['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Service Role Key missing in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable(tableName) {
  try {
    const { data, error } = await supabase.from(tableName).select('*').limit(1);
    if (error) {
      console.log(`Table ${tableName}: NOT FOUND or ERROR:`, error.message);
      return false;
    } else {
      console.log(`Table ${tableName}: EXISTS (Rows count checks out: ${data.length})`);
      return true;
    }
  } catch (e) {
    console.log(`Table ${tableName}: EXCEPTION:`, e.message);
    return false;
  }
}

async function main() {
  console.log('Starting Supabase Database Schema and Table Audit...\n');

  const tables = [
    'users',
    'pharmacies',
    'products',
    'pharmacy_inventory',
    'batches',
    'stock_movements',
    'sales',
    'sale_items',
    'searches',
    'chat_messages',
    'triage_logs',
    'thread_locks',
    'triage_config',
    'rx_submissions',
    'symptom_intakes',
    'research_consent'
  ];

  for (const table of tables) {
    await checkTable(table);
  }

  console.log('\nAudit complete.');
}

main();
