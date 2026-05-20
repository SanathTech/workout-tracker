const fs = require('fs');
const path = require('path');
const db = require('./index');

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✅ Database schema created successfully.');
  } catch (err) {
    console.error('❌ Failed to initialize schema:', err.message);
  } finally {
    await db.pool.end();
  }
}

init();
