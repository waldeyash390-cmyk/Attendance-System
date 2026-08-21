require('dotenv').config();
const { query, close } = require('../src/db');

(async () => {
  const u = await query("SELECT id, email, role FROM users WHERE email = $1", ['mryash258@gmail.com']);
  console.log('USER:', JSON.stringify(u.rows, null, 2));

  if (u.rows[0]) {
    const userId = u.rows[0].id;
    const att = await query(
      `SELECT a.id, a.session_id, a.student_id, a.marked_at, a.confidence,
              s.title, s.subject_id
         FROM attendance a
         LEFT JOIN sessions s ON s.id = a.session_id
        WHERE a.student_id = $1
        ORDER BY a.marked_at DESC`,
      [userId]
    );
    console.log('ATTENDANCE RECORDS:', JSON.stringify(att.rows, null, 2));
  }

  await close();
})().catch((e) => { console.error(e); process.exit(1); });