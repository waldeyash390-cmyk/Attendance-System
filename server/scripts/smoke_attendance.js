require('dotenv').config({ path: __dirname + '/../.env' });
const BASE = process.env.BASE_URL || 'http://localhost:4000';

const { query, close: closeDb } = require('../src/db');

function rand(n) { return Math.random() * n; }
function makeDescriptor(seed = 0) {
  const v = new Array(128);
  for (let i = 0; i < 128; i++) v[i] = +(Math.sin(i + seed) * 0.5 + rand(0.01)).toFixed(6);
  return v;
}

async function http(method, path, body, token) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function ok(label, cond, extra) {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}` + (extra ? ' :: ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

(async () => {
  const stamp = Date.now();

  const teacherEmail = `att.teacher.${stamp}@test.local`;
  const studentAEmail = `att.studA.${stamp}@test.local`;
  const studentBEmail = `att.studB.${stamp}@test.local`;

  console.log('--- registering users ---');
  const tReg = await http('POST', '/api/auth/register', {
    email: teacherEmail, password: 'password123', fullName: 'Att Teacher', role: 'teacher',
  });
  ok('teacher register', tReg.status === 201, 'status=' + tReg.status);
  const teacherToken = tReg.body.token;
  const teacherId = tReg.body.user.id;

  const sAReg = await http('POST', '/api/auth/register', {
    email: studentAEmail, password: 'password123', fullName: 'Alpha Student', role: 'student', rollNumber: 'RA' + stamp,
  });
  ok('studentA register', sAReg.status === 201, 'status=' + sAReg.status);
  const studentAToken = sAReg.body.token;
  const studentAId = sAReg.body.user.id;

  const sBReg = await http('POST', '/api/auth/register', {
    email: studentBEmail, password: 'password123', fullName: 'Beta Student', role: 'student', rollNumber: 'RB' + stamp,
  });
  ok('studentB register', sBReg.status === 201, 'status=' + sBReg.status);
  const studentBId = sBReg.body.user.id;

  console.log('--- enrolling faces ---');
  const descA = makeDescriptor(1);
  const descB = makeDescriptor(2);

  const eA = await http('POST', '/api/face/enroll', { descriptor: descA, source: 'enrollment' }, studentAToken);
  ok('studentA enroll', eA.status === 201, 'status=' + eA.status);

  const eB = await http('POST', '/api/face/enroll', { descriptor: descB, source: 'enrollment' }, sBReg.body.token);
  ok('studentB enroll', eB.status === 201, 'status=' + eB.status);

  console.log('--- creating subject + open session ---');
  const subj = await http('POST', '/api/subjects', {
    code: 'ATT' + stamp, name: 'Attendance Test Subject', department: 'CS', semester: 5,
  }, teacherToken);
  ok('subject create', subj.status === 201, 'status=' + subj.status);
  const subjectId = subj.body.subject.id;

  const sess = await http('POST', '/api/sessions', {
    subjectId, title: 'Step 7 session',
    startAt: new Date(Date.now() - 60 * 1000).toISOString(),
    endAt:   new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isOpen: true,
  }, teacherToken);
  ok('session create', sess.status === 201, 'status=' + sess.status);
  const sessionId = sess.body.session.id;

  console.log('--- test: match success (studentA live descriptor) ---');
  const markA = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: descA,
  }, studentAToken);
  ok('mark studentA status=201', markA.status === 201, 'status=' + markA.status);
  ok('mark studentA matched userId', markA.body && markA.body.match && markA.body.match.userId === studentAId);
  ok('mark studentA distance present', markA.body && markA.body.match && typeof markA.body.match.distance === 'number');
  ok('mark studentA confidence present', markA.body && markA.body.match && typeof markA.body.match.confidence === 'number');

  console.log('--- test: duplicate attendance rejection ---');
  const dup = await http('POST', '/api/attendance/mark', { sessionId, descriptor: descA }, studentAToken);
  ok('duplicate rejected status=409', dup.status === 409, 'status=' + dup.status);
  ok('duplicate error message', dup.body && /already marked/i.test(dup.body.error || ''));

  console.log('--- test: threshold rejection (random descriptor) ---');
  const noise = makeDescriptor(999);
  const noMatch = await http('POST', '/api/attendance/mark', { sessionId, descriptor: noise }, teacherToken);
  ok('no-match status=404', noMatch.status === 404, 'status=' + noMatch.status);
  ok('no-match bestDistance returned', noMatch.body && typeof noMatch.body.bestDistance === 'number');
  ok('no-match threshold returned', noMatch.body && typeof noMatch.body.threshold === 'number');

  console.log('--- test: per-call lower threshold should also reject close-but-not-identical match ---');
  // slightly perturbed version of A
  const perturbed = descA.map((v) => v + 0.0005);
  const tight = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: perturbed, threshold: 0.0001,
  }, teacherToken);
  ok('tight-threshold rejected 404', tight.status === 404, 'status=' + tight.status);

  console.log('--- test: closed session rejected ---');
  const close = await http('POST', `/api/sessions/${sessionId}/close`, {}, teacherToken);
  ok('session close', close.status === 200);
  const closed = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: descB,
  }, sBReg.body.token);
  ok('closed session rejected 409', closed.status === 409, 'status=' + closed.status);

  // reopen for later steps
  const reopen = await http('POST', `/api/sessions/${sessionId}/open`, {}, teacherToken);
  ok('session reopen', reopen.status === 200);

  console.log('--- test: GET /api/attendance/session/:sessionId ---');
  const list = await http('GET', `/api/attendance/session/${sessionId}`, null, teacherToken);
  ok('list status=200', list.status === 200);
  ok('list has summary', list.body && list.body.summary && typeof list.body.summary.total === 'number');
  ok('list records includes studentA', list.body && list.body.records && list.body.records.some(r => r.studentId === studentAId));
  ok('list records total>=1', list.body && list.body.summary && list.body.summary.total >= 1);

  // authorization: student should not be able to list
  const denied = await http('GET', `/api/attendance/session/${sessionId}`, null, sBReg.body.token);
  ok('list by student forbidden 403', denied.status === 403, 'status=' + denied.status);

  console.log('--- test: GET /api/attendance/student/:studentId ---');
  const hist = await http('GET', `/api/attendance/student/${studentAId}`, null, studentAToken);
  ok('history self status=200', hist.status === 200);
  ok('history has stats', hist.body && hist.body.stats && typeof hist.body.stats.attendancePercentage === 'number');
  ok('history has history array', Array.isArray(hist.body && hist.body.history));
  ok('history contains session', hist.body && hist.body.history.some(h => h.sessionId === sessionId));

  const histForbidden = await http('GET', `/api/attendance/student/${studentAId}`, null, sBReg.body.token);
  ok('history forbidden 403', histForbidden.status === 403, 'status=' + histForbidden.status);

  const histAdmin = await http('GET', `/api/attendance/student/${studentAId}`, null, teacherToken);
  ok('history admin/teacher self-id 403 (teacher is not admin)', histAdmin.status === 403, 'status=' + histAdmin.status);

  console.log('--- test: missing sessionId ---');
  const noSess = await http('POST', '/api/attendance/mark', { descriptor: descA }, studentAToken);
  ok('missing sessionId 400', noSess.status === 400);

  console.log('--- test: bad descriptor (wrong length) ---');
  const badDesc = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: new Array(64).fill(0),
  }, studentAToken);
  ok('bad descriptor 400', badDesc.status === 400);

  await closeDb();
  console.log('exitCode=', process.exitCode || 0);
})().catch((e) => {
  console.error('SMOKE ERROR', e);
  process.exit(1);
});
