require('dotenv').config();
const { query, close } = require('../src/db');

(async () => {
  const u = await query(
    "SELECT id, email FROM users WHERE email LIKE 'fs.%' ORDER BY created_at DESC LIMIT 1"
  );
  if (!u.rows[0]) {
    console.log('NO_USER');
    await close();
    return;
  }
  const id = u.rows[0].id;
  console.log('USER:', u.rows[0].email, id);

  const r = await query(
    `SELECT id, is_active, source, quality, jsonb_array_length(descriptor) AS len,
            descriptor[1] AS d0, descriptor[128] AS d127
       FROM face_descriptors
      WHERE user_id = $1
      ORDER BY created_at`,
    [id]
  );
  console.log(JSON.stringify(r.rows, null, 2));

  const counts = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM face_descriptors WHERE user_id = $1`,
    [id]
  );
  console.log('COUNTS:', counts.rows[0]);

  await close();
})().catch((e) => { console.error(e); process.exit(1); });
