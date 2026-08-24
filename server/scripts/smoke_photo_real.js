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
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

(async () => {
  const stamp = Date.now();
  const teacherEmail = `pht.teacher.${stamp}@test.local`;
  const studentEmail = `pht.stud.${stamp}@test.local`;

  const tReg = await http('POST', '/api/auth/register', {
    email: teacherEmail, password: 'password123', fullName: 'Pht Teacher', role: 'teacher',
    inviteCode: process.env.TEACHER_INVITE_CODE, phoneNumber: '+15550000001',
  });
  ok('teacher register', tReg.status === 201, 'status=' + tReg.status);
  const teacherToken = tReg.body.token;

  const sReg = await http('POST', '/api/auth/register', {
    email: studentEmail, password: 'password123', fullName: 'Pht Student', role: 'student',
    rollNumber: 'R' + stamp, phoneNumber: '+15550000002',
  });
  ok('student register', sReg.status === 201, 'status=' + sReg.status);
  const studentToken = sReg.body.token;
  const studentId = sReg.body.user.id;

  const imgB64 = fs.readFileSync(process.env.PHOTO_FILE, 'base64');
  const dataUrl = 'data:image/png;base64,' + imgB64;

  console.log('--- teacher uploads photo for student via PUT /api/profile/:userId ---');
  const teacherUpd = await http('PUT', `/api/profile/${studentId}`, {
    fullName: 'Pht Student', rollNumber: 'R' + stamp, email: studentEmail,
    phoneNumber: '+15550000002', department: 'CS', profilePhoto: dataUrl,
  }, teacherToken);
  console.log('teacher update status:', teacherUpd.status);
  console.log('teacher update body:', JSON.stringify(teacherUpd.body).slice(0, 500));
  ok('teacher update 200', teacherUpd.status === 200);
  const photoUrl = teacherUpd.body && teacherUpd.body.profile && teacherUpd.body.profile.profilePhotoUrl;
  ok('response has profilePhotoUrl', !!photoUrl, 'url=' + photoUrl);

  console.log('uploads dir:', fs.readdirSync(UPLOAD_DIR));

  if (photoUrl) {
    const photo = await http('GET', photoUrl, null, studentToken);
    console.log('photo GET via student token:', photo.status, 'CT:', photo.headers && photo.headers['content-type']);
    ok('photo GET 200', photo.status === 200);
  }

  await closeDb();
  console.log('exitCode=', process.exitCode || 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
