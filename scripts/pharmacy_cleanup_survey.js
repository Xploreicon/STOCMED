const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read env variables from .env.local
const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local file not found at:', envPath);
  process.exit(1);
}

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

async function run() {
  try {
    // 1. Fetch all pharmacies
    const { data: pharmacies, error: pError } = await supabase
      .from('pharmacies')
      .select('id, user_id, pharmacy_name, license_number, city, created_at');
    
    if (pError) throw pError;

    // 2. Fetch all users from public.users (for emails)
    const { data: users, error: uError } = await supabase
      .from('users')
      .select('user_id, email');
      
    if (uError) throw uError;

    // 3. Fetch all auth users from supabase authentication (as fallback/supplement)
    let authUsers = [];
    try {
      const { data: { users: aUsers } } = await supabase.auth.admin.listUsers();
      authUsers = aUsers || [];
    } catch (e) {
      console.warn('Warning: Could not fetch auth users:', e.message);
    }

    // 4. Fetch all inventory to count items per pharmacy
    const { data: inventory, error: iError } = await supabase
      .from('pharmacy_inventory')
      .select('pharmacy_id, product_id');
      
    if (iError) throw iError;

    // 5. Fetch all sales to count sales per pharmacy
    const { data: sales, error: sError } = await supabase
      .from('sales')
      .select('pharmacy_id, id');
      
    if (sError) throw sError;

    // Build lookup maps
    const emailMap = {};
    authUsers.forEach(u => {
      emailMap[u.id] = u.email;
    });
    users.forEach(u => {
      emailMap[u.user_id] = u.email;
    });

    const inventoryCountMap = {};
    inventory.forEach(item => {
      inventoryCountMap[item.pharmacy_id] = (inventoryCountMap[item.pharmacy_id] || 0) + 1;
    });

    const salesCountMap = {};
    sales.forEach(sale => {
      salesCountMap[sale.pharmacy_id] = (salesCountMap[sale.pharmacy_id] || 0) + 1;
    });

    // Check duplicates of license_number (normalized)
    const normalizedPcns = pharmacies.map(p => {
      const pcn = p.license_number || '';
      return pcn.toUpperCase().trim();
    });

    const pcnCounts = {};
    normalizedPcns.forEach(pcn => {
      if (pcn) {
        pcnCounts[pcn] = (pcnCounts[pcn] || 0) + 1;
      }
    });

    // Map pharmacy rows
    const results = pharmacies.map(p => {
      const email = emailMap[p.user_id] || 'No linked user';
      const inventoryCount = inventoryCountMap[p.id] || 0;
      const salesCount = salesCountMap[p.id] || 0;
      const pcn = p.license_number || '';
      const normPcn = pcn.toUpperCase().trim();
      
      const hasInventory = inventoryCount > 0;
      const hasSales = salesCount > 0;
      
      const isDuplicatePcn = pcnCounts[normPcn] > 1;
      const isPlausiblePcn = /^[0-9]{6,9}$/.test(normPcn);
      
      // Suspect patterns (obvious placeholders or bad sequences)
      const isTestPcn = !isPlausiblePcn || 
                         normPcn === '123456' || 
                         normPcn === '654321' || 
                         normPcn === '111111' || 
                         normPcn === '222222' || 
                         normPcn === '333333' || 
                         normPcn === '000000' || 
                         normPcn === '1234567' || 
                         normPcn === '12345678' || 
                         normPcn === '123456789';
      
      const noActivity = !hasInventory && !hasSales;

      const flags = [];
      if (isDuplicatePcn) flags.push('DUPLICATE PCN');
      if (isTestPcn) flags.push(isPlausiblePcn ? 'SUSPICIOUS PCN' : 'INVALID PCN FORMAT');
      if (noActivity) flags.push('NO ACTIVITY');

      return {
        id: p.id,
        name: p.pharmacy_name,
        pcn: pcn,
        city: p.city,
        email: email,
        created_at: p.created_at,
        inventory_count: inventoryCount,
        sales_count: salesCount,
        flags: flags.length > 0 ? flags : ['OK']
      };
    });

    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Error during data survey:', error);
    process.exit(1);
  }
}

run();
