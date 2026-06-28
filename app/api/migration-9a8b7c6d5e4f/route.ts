import { NextResponse } from 'next/server';
const { Client } = require('pg');

export async function POST(request: Request) {
  try {
    // Disable TLS verification check globally for this process execution
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const connectionString = request.headers.get('x-database-url');
    if (!connectionString) {
      return NextResponse.json({ error: 'Missing x-database-url header' }, { status: 400 });
    }

    const body = await request.json();
    const sql = body.sql;

    if (!sql) {
      return NextResponse.json({ error: 'Missing sql' }, { status: 400 });
    }

    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    await client.query(sql);
    await client.end();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
