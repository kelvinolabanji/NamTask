require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running AI matching schema migration…');
    const sql = fs.readFileSync(path.join(__dirname, 'migrate_matching.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ AI matching schema applied');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
