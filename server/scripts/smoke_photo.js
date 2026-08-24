require('dotenv').config({ path: __dirname + '/../.env' });
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const fs = require('fs');
const path = require('path');

const { query, close: closeDb } = require('../src/db');

const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');

function ok(label, cond, extra) {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}` + (extra ? ' :: ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

async function http(method, p, body, token) {
  const url = BASE + p;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json };
}

(async () => {
  const stamp = Date.now();
  const studentEmail = `photo.stud.${stamp}@test.local`;

  console.log('--- register student ---');
  const reg = await http('POST', '/api/auth/register', {
    email: studentEmail, password: 'password123', fullName: 'Photo Test', role: 'student',
    rollNumber: 'RP' + stamp, phoneNumber: '+15551234567',
  });
  console.log('register response:', JSON.stringify(reg.body));
  ok('student register', reg.status === 201, 'status=' + reg.status);
  const studentToken = reg.body.token;
  const studentId = reg.body.user.id;

  console.log('--- list uploads dir BEFORE ---');
  if (fs.existsSync(UPLOAD_DIR)) {
    const before = fs.readdirSync(UPLOAD_DIR);
    console.log('uploads dir before:', before);
  } else {
    console.log('uploads dir does NOT exist');
  }

  // 1x1 red png
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const dataUrl = 'data:image/png;base64,' + pngB64;

  console.log('--- PUT /api/profile/me with photo ---');
  const upd = await http('PUT', '/api/profile/me', {
    fullName: 'Photo Test',
    rollNumber: 'RP' + stamp,
    email: studentEmail,
    phoneNumber: '+15551234567',
    profilePhoto: dataUrl,
  }, studentToken);
  console.log('update status:', upd.status, 'body:', JSON.stringify(upd.body).slice(0, 400));
  ok('update 200', upd.status === 200);
  const photoUrl = upd.body && upd.body.profile && upd.body.profile.profilePhotoUrl;
  ok('response includes profilePhotoUrl', !!photoUrl, 'url=' + photoUrl);

  console.log('--- list uploads dir AFTER ---');
  const after = fs.readdirSync(UPLOAD_DIR);
  console.log('uploads dir after:', after);

  if (photoUrl) {
    console.log('--- GET photo URL directly via /api/uploads/... ---');
    const photo = await http('GET', photoUrl, null, studentToken);
    console.log('photo status:', photo.status);
    console.log('photo headers content-type:', photo.headers['content-type']);
    console.log('photo body sample (first 80 chars):', String(photo.body).slice(0, 80));
    ok('photo GET 200', photo.status === 200);

    // Check if the file actually exists on disk
    const filename = photoUrl.split('/').pop();
    const full = path.join(UPLOAD_DIR, filename);
    const exists = fs.existsSync(full);
    console.log('file on disk?', full, '->', exists);
    ok('photo file on disk', exists);
  }

  console.log('--- GET /api/profile/me to confirm DB stored url ---');
  const me = await http('GET', '/api/profile/me', null, studentToken);
  console.log('me body:', JSON.stringify(me.body).slice(0, 400));
  ok('me 200', me.status === 200);
  ok('me has profilePhotoUrl', !!(me.body && me.body.profile && me.body.profile.profilePhotoUrl));

  await closeDb();
  console.log('exitCode=', process.exitCode || 0);
})().catch((e) => {
  console.error('SMOKE ERROR', e);
  process.exit(1);
});
