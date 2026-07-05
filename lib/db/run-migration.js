const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = path.join(__dirname, '../../.env.local');
let databaseUrl = process.env.DATABASE_URL;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DATABASE_URL=["']?([^"'\n]+)["']?/);
  if (match) {
    databaseUrl = match[1];
  }
}

if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is not defined.');
  process.exit(1);
}

// Supabase DB connection URL might contain percent-encoded characters, pg client handles it.
const client = new Client({
  connectionString: databaseUrl,
});

async function main() {
  const migrationFile = path.join(__dirname, '../../supabase/migrations/20260705000001_triage_and_safety.sql');
  if (!fs.existsSync(migrationFile)) {
    console.error(`Migration file not found: ${migrationFile}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected successfully. Executing migration...');
  
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error applying migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
