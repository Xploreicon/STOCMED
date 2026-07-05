process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');

const connectionString = "postgresql://postgres.iesbktqljjseiryeqbjn:_Y2u%252HCa5Pw2tz@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

async function main() {
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('CONNECTED TO POOLER SUCCESS!');
    const res = await client.query('SELECT current_database(), current_user;');
    console.log('Query result:', res.rows[0]);
  } catch (err) {
    console.error('Connection failed:', err);
  } finally {
    await client.end();
  }
}

main();
