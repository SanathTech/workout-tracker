const { Pool, types } = require('pg');
require('dotenv').config();

// DATE (oid 1082) is a calendar day with no time and no zone. The driver's default is
// to build a JS Date at the *server's* local midnight, which JSON then serialises as a
// UTC instant — so the same stored day comes back as a different day depending on the
// server's TZ. Hand back the raw 'YYYY-MM-DD' string instead.
types.setTypeParser(1082, (value) => value);

// On Vercel every cold lambda constructs its own pool, so a large `max` multiplies
// straight into Neon's connection ceiling. One connection per instance is what a
// single-request-at-a-time serverless handler can actually use. Point DATABASE_URL at
// Neon's *pooled* (-pooler) host so pgbouncer absorbs the churn.
const onServerless = Boolean(process.env.VERCEL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: onServerless ? 1 : 10,
  idleTimeoutMillis: onServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});

// Log and let the pool retire the client. The previous process.exit(-1) here tore down
// a whole lambda instance — which on Vercel can be serving another request.
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
