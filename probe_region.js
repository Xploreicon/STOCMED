process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');

const regions = [
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
  'ca-central-1', 'sa-east-1', 'af-south-1', 'ap-northeast-3'
];

async function tryRegion(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.iesbktqljjseiryeqbjn:_Y2u%252HCa5Pw2tz@${host}:6543/postgres`;
  
  const client = new Client({
    connectionString: connectionString,
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    console.log(`=== SUCCESS IN REGION: ${region} ===`);
    const res = await client.query('SELECT current_database();');
    console.log('Result:', res.rows[0]);
    await client.end();
    return true;
  } catch (err) {
    console.log(`Region ${region}: ${err.message}`);
    return false;
  }
}

async function main() {
  for (const region of regions) {
    await tryRegion(region);
  }
  console.log('All regions finished.');
}

main();
