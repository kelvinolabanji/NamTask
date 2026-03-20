require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running safety system v2 migration…');
    const sql = fs.readFileSync(path.join(__dirname, 'migrate_safety_v2.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Safety schema v2 applied');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
