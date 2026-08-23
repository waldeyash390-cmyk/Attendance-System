const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db');
const authRouter = require('./routes/auth');
const subjectsRouter = require('./routes/subjects');
const sessionsRouter = require('./routes/sessions');
const faceRouter = require('./routes/face');
const attendanceRouter = require('./routes/attendance');
const usersRouter = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const profileRouter = require('./routes/profile');

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRouter);
app.use('/api/subjects', subjectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/face', faceRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/users', usersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/profile', profileRouter);

// Serve uploaded profile photos from server/uploads/. The URL stored on the
// user record points here directly (e.g. /api/uploads/profile_xyz.jpg).
const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use(
  '/api/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '1d',
    fallthrough: false,
    index: false,
  }),
);

app.get('/api/health', async (req, res) => {
  const payload = {
    status: 'ok',
    service: 'attendance-server',
    time: new Date().toISOString(),
    db: { configured: Boolean(process.env.DATABASE_URL), ok: false },
  };

  if (!process.env.DATABASE_URL) {
    payload.db.error = 'DATABASE_URL not set';
    return res.status(200).json(payload);
  }

  try {
    const row = await db.ping();
    payload.db.ok = true;
    payload.db.now = row.now;
    res.json(payload);
  } catch (err) {
    payload.db.error = err.message;
    payload.status = 'degraded';
    res.status(503).json(payload);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down`);
  server.close(async () => {
    try {
      await db.close();
    } catch (err) {
      console.error('[db] error during shutdown', err);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
