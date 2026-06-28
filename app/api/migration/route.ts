import { NextResponse } from 'next/server';
const { Client } = require('pg');

export async function POST(request: Request) {
  const secret = request.headers.get('x-migration-secret');
  const expectedSecret = process.env.DATABASE_URL?.split(':')[2]?.split('@')[0];
  
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const sql = body.sql;

    if (!sql) {
      return NextResponse.json({ error: 'Missing sql' }, { status: 400 });
    }

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
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
