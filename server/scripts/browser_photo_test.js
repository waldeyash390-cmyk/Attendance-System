// Headless test driver using Edge via CDP.
// Steps:
// 1) GET /api/auth/login as the test student to obtain a JWT
// 2) Launch headless Edge with --remote-debugging-port=9222
// 3) Open localhost:5173/login, set localStorage 'attendance.token' to the JWT, then navigate to /profile
// 4) Wait for the profile page to render and read out the <img> element's src + naturalWidth/Height
// 5) Also navigate to / and check the dashboard avatar
// 6) Print everything

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const STUDENT_EMAIL = process.env.STUDENT_EMAIL || 'photo.stud.1787549256730@test.local';
const PASSWORD = process.env.PASSWORD || 'password123';
const API = 'http://localhost:4000';
const APP = 'http://localhost:5173';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login() {
  const r = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: STUDENT_EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j));
  return j.token;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json from ' + url + ': ' + data)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const token = await login();
  console.log('token obtained, length=', token.length);

  const userDir = path.join(process.env.TEMP || 'C:\\Users\\Admin\\AppData\\Local\\Temp', 'edge-photo-test');
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(userDir, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    'about:blank',
  ];
  const edge = spawn(EDGE, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  edge.on('exit', (c) => console.log('edge exited with', c));

  // Wait for devtools
  for (let i = 0; i < 40; i++) {
    try {
      const v = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
      console.log('edge devtools ready:', v.Browser);
      break;
    } catch {
      await sleep(250);
    }
  }

  // Get the first page target
  const targets = await fetchJson(`http://127.0.0.1:${PORT}/json`);
  let page = targets.find(t => t.type === 'page');
  if (!page) {
    // Open a new page by visiting about:blank via /json/new
    const newPage = await new Promise((resolve, reject) => {
      http.put(`http://127.0.0.1:${PORT}/json/new?about:blank`, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
      });
    });
    page = newPage;
  }
  const wsUrl = page.webSocketDebuggerUrl;
  console.log('page ws:', wsUrl);

  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  function send(method, params = {}) {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // First navigate to a blank-ish URL on our origin so we can set localStorage.
  // We can use Page.addScriptToEvaluateOnNewDocument to set localStorage when any
  // page loads.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('attendance.token', ${JSON.stringify(token)});`,
  });

  console.log('--- navigating to /login to make sure we are on the app origin ---');
  await send('Page.navigate', { url: APP + '/login' });
  await sleep(2500);

  console.log('--- now /profile ---');
  await send('Page.navigate', { url: APP + '/profile' });
  await sleep(3500);

  async function evalInPage(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  }

  console.log('=== PROFILE PAGE ===');
  console.log('img count:', await evalInPage(`document.querySelectorAll('img').length`));
  const profileImgInfo = await evalInPage(`(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(i => ({
      src: i.getAttribute('src'),
      naturalWidth: i.naturalWidth,
      naturalHeight: i.naturalHeight,
      complete: i.complete,
      alt: i.getAttribute('alt'),
    }));
  })()`);
  console.log('profile imgs:', JSON.stringify(profileImgInfo, null, 2));

  console.log('--- now / (dashboard) ---');
  await send('Page.navigate', { url: APP + '/' });
  await sleep(3500);

  console.log('=== DASHBOARD ===');
  console.log('img count:', await evalInPage(`document.querySelectorAll('img').length`));
  const dashImgInfo = await evalInPage(`(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(i => ({
      src: i.getAttribute('src'),
      naturalWidth: i.naturalWidth,
      naturalHeight: i.naturalHeight,
      complete: i.complete,
      alt: i.getAttribute('alt'),
    }));
  })()`);
  console.log('dashboard imgs:', JSON.stringify(dashImgInfo, null, 2));

  // Now do a direct image fetch in the page context to see what happens
  const directFetch = await evalInPage(`(async () => {
    const imgs = Array.from(document.querySelectorAll('img'));
    if (!imgs.length) return { error: 'no imgs' };
    const src = imgs[0].getAttribute('src');
    try {
      const r = await fetch(src, { credentials: 'include' });
      return { src, status: r.status, ct: r.headers.get('content-type'), ok: r.ok };
    } catch (e) { return { src, error: String(e) }; }
  })()`);
  console.log('direct fetch in page:', JSON.stringify(directFetch, null, 2));

  ws.close();
  edge.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => { console.error('test error', e); process.exit(1); });
