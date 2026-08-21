const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[db] DATABASE_URL is not set; DB queries will fail until it is configured.');
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const durationMs = Date.now() - start;
  if (durationMs > 500) {
    console.warn(`[db] slow query ${durationMs}ms: ${text}`);
  }
  return res;
}

async function ping() {
  const res = await pool.query('SELECT 1 AS ok, NOW() AS now');
  return res.rows[0];
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, ping, close };
