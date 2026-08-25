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

// Runs `fn(client)` inside a single BEGIN/COMMIT transaction. On any throw
// the work is rolled back and the error re-thrown. Used by the face
// enrollment + update-request endpoints so the lock check + write happen
// atomically.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('[db] rollback failed', rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, ping, close, withTransaction };
