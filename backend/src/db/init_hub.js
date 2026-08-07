const fs = require('fs');
const path = require('path');
const db = require('./index');

// Separate from init.js because schema.sql wipes; schema_hub.sql only ever adds.
// This one is safe to run against production any time.
async function initHub() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema_hub.sql'), 'utf8');
  try {
    await db.query(sql);
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('activities','training_load','wellness_daily','checkins',
                            'session_feel','coach_advice','coach_messages','sync_state')
       ORDER BY table_name`
    );
    console.log(`✅ Hub schema applied. ${rows.length}/8 tables present:`);
    console.log('   ' + rows.map((r) => r.table_name).join(', '));
    process.exitCode = rows.length === 8 ? 0 : 1;
  } catch (err) {
    console.error('❌ Failed to apply hub schema:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

initHub();
