require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running payments v2 migration...');
    const sql = fs.readFileSync(path.join(__dirname, 'migrate_payments_v2.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Payments v2 schema applied');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
