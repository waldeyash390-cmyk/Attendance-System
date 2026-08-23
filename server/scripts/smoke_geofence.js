// Geofencing smoke tests. Requires the API server to be running
// (`npm start` or `npm run dev` in server/) and DATABASE_URL set.
// Run: node scripts/smoke_geofence.js
require('dotenv').config({ path: __dirname + '/../.env' });
const BASE = process.env.BASE_URL || 'http://localhost:4000';

const { close: closeDb } = require('../src/db');
const { haversineDistanceMeters } = require('../src/utils/geo');

// Campus reference point used for this test run.
const CAMPUS = { lat: 12.9716, lng: 77.5946 };
const RADIUS = 100;
// ~0.0009 deg lat is roughly 100 m; stay comfortably inside.
const INSIDE = { lat: CAMPUS.lat + 0.0005, lng: CAMPUS.lng };
// ~0.01 deg lat is roughly 1.1 km; well outside any sane radius.
const OUTSIDE = { lat: CAMPUS.lat + 0.01, lng: CAMPUS.lng };

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

  console.log('--- unit: haversine utility ---');
  ok('same point -> 0', haversineDistanceMeters(12.9716, 77.5946, 12.9716, 77.5946) === 0);
  const d111 = haversineDistanceMeters(12.9716, 77.5946, 12.9726, 77.5946);
  ok('0.001 deg lat ~= 111 m', d111 > 105 && d111 < 118, `got ${d111 && d111.toFixed(1)}m`);
  const dKm = haversineDistanceMeters(12.9716, 77.5946, 12.9816, 77.5946);
  ok('0.01 deg lat ~= 1.11 km', dKm > 1080 && dKm < 1150, `got ${dKm && dKm.toFixed(0)}m`);
  ok('invalid coords -> null', haversineDistanceMeters(null, 0, 0, 0) === null);
  ok('out-of-range lat -> null', haversineDistanceMeters(91, 0, 0, 0) === null);

  console.log('--- setup: users, faces, subject, geofenced session ---');
  const tReg = await http('POST', '/api/auth/register', {
    email: `geo.teacher.${stamp}@test.local`, password: 'password123',
    fullName: 'Geo Teacher', role: 'teacher', inviteCode: process.env.TEACHER_INVITE_CODE,
  });
  ok('teacher register', tReg.status === 201, 'status=' + tReg.status);
  const teacherToken = tReg.body.token;

  async function makeStudent(name, roll, seed) {
    const r = await http('POST', '/api/auth/register', {
      email: `geo.${roll}.${stamp}@test.local`, password: 'password123',
      fullName: name, role: 'student', rollNumber: roll,
    });
    ok(`register ${name}`, r.status === 201, 'status=' + r.status);
    // Distinct descriptor per seed so face matching identifies the right student.
    const desc = new Array(128).fill(0).map((_, i) => +(Math.sin(i + seed) * 0.5).toFixed(6));
    const e = await http('POST', '/api/face/enroll', { descriptor: desc }, r.body.token);
    ok(`enroll ${name}`, e.status === 201, 'status=' + e.status);
    return { token: r.body.token, id: r.body.user.id, descriptor: desc };
  }
  const alice = await makeStudent('Alice Inside', 'GA' + stamp, 11);
  const bob = await makeStudent('Bob Outside', 'GB' + stamp, 22);

  const subj = await http('POST', '/api/subjects', {
    code: 'GEO' + stamp, name: 'Geofence Test Subject', department: 'CS', semester: 5,
  }, teacherToken);
  ok('subject create', subj.status === 201, 'status=' + subj.status);
  const subjectId = subj.body.subject.id;

  const sess = await http('POST', '/api/sessions', {
    subjectId,
    title: 'Geofenced session',
    startAt: new Date(Date.now() - 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isOpen: true,
    campusLat: CAMPUS.lat,
    campusLng: CAMPUS.lng,
    radiusMeters: RADIUS,
  }, teacherToken);
  ok('geofenced session create', sess.status === 201, 'status=' + sess.status);
  ok('session stores campusLat', sess.body.session.campusLat === CAMPUS.lat);
  ok('session stores campusLng', sess.body.session.campusLng === CAMPUS.lng);
  ok('session stores radiusMeters', sess.body.session.radiusMeters === RADIUS);
  const sessionId = sess.body.session.id;

  console.log('--- test: marking without coords is refused on geofenced session ---');
  const noCoords = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: alice.descriptor, livenessPassed: true,
  }, alice.token);
  ok('missing coords rejected 400', noCoords.status === 400, 'status=' + noCoords.status);
  ok('missing coords message mentions location', /location/i.test(noCoords.body.error || ''));

  console.log('--- test: student INSIDE radius -> accepted and counted ---');
  const insideMark = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: alice.descriptor, livenessPassed: true,
    lat: INSIDE.lat, lng: INSIDE.lng, accuracy: 8,
  }, alice.token);
  ok('inside mark status=201', insideMark.status === 201, 'status=' + insideMark.status);
  ok('inside mark attendance recorded', insideMark.body.attendance && insideMark.body.attendance.id);
  ok('inside mark location returned within radius',
     insideMark.body.location && insideMark.body.location.distanceMeters <= RADIUS,
     JSON.stringify(insideMark.body.location));
  ok('inside mark status=present', insideMark.body.attendance && insideMark.body.attendance.status === 'present');

  console.log('--- test: duplicate inside-radius mark still 409 ---');
  const dupInside = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: alice.descriptor, livenessPassed: true,
    lat: INSIDE.lat, lng: INSIDE.lng, accuracy: 8,
  }, alice.token);
  ok('duplicate 409 preserved', dupInside.status === 409, 'status=' + dupInside.status);

  console.log('--- test: student OUTSIDE radius -> rejected, logged, NOT counted ---');
  const outsideMark = await http('POST', '/api/attendance/mark', {
    sessionId, descriptor: bob.descriptor, livenessPassed: true,
    lat: OUTSIDE.lat, lng: OUTSIDE.lng, accuracy: 12,
  }, bob.token);
  ok('outside mark rejected 403', outsideMark.status === 403, 'status=' + outsideMark.status);
  ok('outside mark code=OUTSIDE_GEOFENCE', outsideMark.body.code === 'OUTSIDE_GEOFENCE');
  ok('outside mark message exact format',
     typeof outsideMark.body.error === 'string'
       && /^You are outside the session area \(\d+ meters away\) — attendance not counted\.$/.test(outsideMark.body.error),
     outsideMark.body.error);
  ok('outside mark distance reported', Number(outsideMark.body.distanceMeters) > RADIUS,
     String(outsideMark.body.distanceMeters));

  console.log('--- verify: attendance list shows Alice, never Bob ---');
  const list = await http('GET', `/api/attendance/session/${sessionId}`, null, teacherToken);
  ok('attendance list 200', list.status === 200);
  ok('alice counted once', list.body.records.filter((r) => r.studentId === alice.id).length === 1);
  ok('bob has NO attendance record', !list.body.records.some((r) => r.studentId === bob.id));

  console.log('--- verify: attempt log has both attempts ---');
  const att = await http('GET', `/api/attendance/session/${sessionId}/attempts`, null, teacherToken);
  ok('attempts endpoint 200', att.status === 200);
  ok('attempts summary total=2', att.body.summary && att.body.summary.total === 2, JSON.stringify(att.body.summary));
  ok('attempts summary accepted=1 rejected=1',
     att.body.summary.accepted === 1 && att.body.summary.rejected === 1);
  const aliceAtt = att.body.attempts.find((a) => a.studentId === alice.id);
  const bobAtt = att.body.attempts.find((a) => a.studentId === bob.id);
  ok('alice attempt accepted with name+distance',
     aliceAtt && aliceAtt.status === 'accepted' && aliceAtt.studentName === 'Alice Inside'
       && aliceAtt.distance != null && aliceAtt.distance <= RADIUS);
  ok('bob attempt rejected_location with name+distance',
     bobAtt && bobAtt.status === 'rejected_location' && bobAtt.studentName === 'Bob Outside'
       && bobAtt.distance > RADIUS);
  ok('attempt timestamps present', Boolean(aliceAtt && aliceAtt.timestamp && bobAtt && bobAtt.timestamp));

  console.log('--- verify: rejected attempt is neutral in analytics (like excused) ---');
  // End the session so it enters the analytics window.
  await http('POST', `/api/sessions/${sessionId}/close`, {}, teacherToken);
  const pastEnd = await http('PUT', `/api/sessions/${sessionId}`, {
    title: 'Geofenced session',
    startAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }, teacherToken);
  ok('session moved to past', pastEnd.status === 200, 'status=' + pastEnd.status);
  ok('geo fields survive edit', pastEnd.body.session.campusLat === CAMPUS.lat
     && pastEnd.body.session.radiusMeters === RADIUS);

  const ana = await http('GET', `/api/analytics/subject/${subjectId}`, null, teacherToken);
  ok('analytics 200', ana.status === 200);
  const anaAlice = ana.body.students.find((s) => s.id === alice.id);
  const anaBob = ana.body.students.find((s) => s.id === bob.id);
  ok('alice attended=1, percentage=100',
     anaAlice && anaAlice.attended === 1 && anaAlice.percentage === 100,
     JSON.stringify({ attended: anaAlice.attended, percentage: anaAlice.percentage }));
  ok('bob attended=0 AND absent=0 AND marked=0 (excluded both ways)',
     anaBob && anaBob.attended === 0 && anaBob.absent === 0 && anaBob.marked === 0,
     JSON.stringify({ attended: anaBob.attended, absent: anaBob.absent, marked: anaBob.marked }));

  console.log('--- verify: student history endpoint still works ---');
  const hist = await http('GET', `/api/attendance/student/${alice.id}`, null, alice.token);
  ok('alice history 200 with session', hist.status === 200
     && hist.body.history.some((h) => h.sessionId === sessionId));

  console.log('--- regression: non-geofenced session needs no coords ---');
  const subj2 = await http('POST', '/api/subjects', {
    code: 'PLAIN' + stamp, name: 'Plain Subject', department: 'CS', semester: 5,
  }, teacherToken);
  const sess2 = await http('POST', '/api/sessions', {
    subjectId: subj2.body.subject.id,
    startAt: new Date(Date.now() - 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isOpen: true,
  }, teacherToken);
  ok('plain session create', sess2.status === 201);
  ok('plain session has null geo', sess2.body.session.campusLat === null
     && sess2.body.session.radiusMeters === null);
  const plainMark = await http('POST', '/api/attendance/mark', {
    sessionId: sess2.body.session.id, descriptor: bob.descriptor, livenessPassed: true,
  }, bob.token);
  ok('plain session mark without coords 201', plainMark.status === 201, 'status=' + plainMark.status);

  await closeDb();
  console.log('exitCode=', process.exitCode || 0);
})().catch((e) => {
  console.error('SMOKE ERROR', e);
  process.exit(1);
});
