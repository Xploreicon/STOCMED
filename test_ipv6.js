process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');

const host = 'db.iesbktqljjseiryeqbjn.supabase.co';

async function tryConnect(password) {
  console.log(`Trying connection with password length ${password.length}...`);
  const client = new Client({
    host: host,
    port: 5432,
    user: 'postgres',
    password: password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('CONNECTED TO DB SUCCESS!');
    const res = await client.query('SELECT current_database(), current_user;');
    console.log('Result:', res.rows[0]);
    await client.end();
    return client;
  } catch (err) {
    console.error('Connection failed:', err.message);
    return null;
  }
}

async function main() {
  // Test decoded password
  const p1 = decodeURIComponent('_Y2u%252HCa5Pw2tz'); // "_Y2u%2HCa5Pw2tz"
  const p2 = '_Y2u%252HCa5Pw2tz';
  const p3 = '_Y2uCa5Pw2tz';

  console.log('Decoded p1:', p1);
  console.log('Raw p2:', p2);

  let success = await tryConnect(p1);
  if (!success) {
    success = await tryConnect(p2);
  }
  if (!success) {
    success = await tryConnect(p3);
  }
}

main();
