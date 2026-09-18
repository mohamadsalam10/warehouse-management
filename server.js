'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const settings = require('./lib/config');
const device = require('./lib/device');
const store = require('./lib/store');
const att = require('./lib/attendance');

if (settings.missing.length) console.warn('WARNING — missing env vars: ' + settings.missing.join(', '));

const hmac = (s) => crypto.createHmac('sha256', settings.sessionSecret).update(String(s)).digest('hex');
const SESSION_HOURS = 12;
function makeToken() { const exp = Date.now() + SESSION_HOURS * 3600 * 1000; return `${exp}.${hmac(exp)}`; }
function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf('.'); if (i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = hmac(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}
const isAuthed = (req) => validToken(getCookie(req, 'session'));
function safeEqual(a, b) { const ab = Buffer.from(String(a)), bb = Buffer.from(String(b)); return ab.length === bb.length && crypto.timingSafeEqual(ab, bb); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function sendJSON(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); }
async function readBody(req) { const c = []; for await (const x of req) c.push(x); const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {}; }
function serveFile(res, file) {
  const full = path.join(__dirname, 'public', file);
  if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res); return true;
  }
  return false;
}

function daysInMonth(month) { // month = "YYYY-MM"
  const [y, m] = month.split('-').map(Number);
  const out = []; const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const route = u.pathname;
  const q = u.searchParams;

  try {
    // ---- public ----
    if (route === '/login') return void serveFile(res, 'login.html');
    if (route === '/api/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (settings.dashboardPassword && safeEqual(password || '', settings.dashboardPassword)) {
        res.writeHead(200, { 'Set-Cookie': `session=${encodeURIComponent(makeToken())}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${SESSION_HOURS * 3600}`, 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      return sendJSON(res, 401, { error: 'Wrong password' });
    }
    if (route === '/api/logout') { res.writeHead(302, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0', Location: '/login' }); return res.end(); }

    // ---- gate ----
    if (!isAuthed(req)) {
      if (route.startsWith('/api/')) return sendJSON(res, 401, { error: 'Not logged in' });
      res.writeHead(302, { Location: '/login' }); return res.end();
    }

    const branch = settings.getBranch(q.get('branch'));

    if (route === '/api/config') {
      const meta = store.getBranchMeta();
      const branches = settings.branches.map((br) => {
        const pb = settings.publicBranch(br);
        const m = meta[br.id] || {};
        return { ...pb, name: m.name || pb.name, city: m.city || pb.city };
      });
      const cities = [...new Set(branches.map((x) => x.city))];
      return sendJSON(res, 200, { branches, cities, doorsEnabled: settings.enableDoors });
    }

    // Setup: assign a branch's display name / city (persisted)
    if (route === '/api/branchmeta' && req.method === 'GET') return sendJSON(res, 200, store.getBranchMeta());
    if (route === '/api/branchmeta' && req.method === 'PUT') {
      const body = await readBody(req); // { id, city, name }
      if (!body.id) return sendJSON(res, 400, { error: 'id is required' });
      return sendJSON(res, 200, store.saveBranchMeta(body.id, { city: body.city, name: body.name }));
    }

    // Overview: open/closed + on-site for every branch at once (command centre)
    if (route === '/api/overview') {
      const meta = store.getBranchMeta();
      const rows = await Promise.all(settings.branches.map(async (br) => {
        const m = meta[br.id] || {};
        const name = m.name || br.name;
        const city = m.city || br.city;
        try {
          const date = device.todayInTz(br.tzOffset);
          const events = await device.getEventsForDay(br, date);
          const people = att.summariseDay(events, { viewingToday: true });
          const { alerts } = att.evaluateDay(br.id, people, br.tzOffset);
          const onSite = people.filter((p) => p.onSite).length;
          return { id: br.id, name, city, ok: true, open: onSite > 0, onSite, peopleToday: people.length, alerts: alerts.length };
        } catch (e) {
          return { id: br.id, name, city, ok: false, error: e.message, open: false, onSite: 0, peopleToday: 0, alerts: 0 };
        }
      }));
      return sendJSON(res, 200, {
        branches: rows,
        branchesOpen: rows.filter((r) => r.open).length,
        branchesTotal: rows.length,
        staffOnSite: rows.reduce((s, r) => s + r.onSite, 0),
      });
    }

    // Live: today's on-site status + alerts
    if (route === '/api/live') {
      const date = device.todayInTz(branch.tzOffset);
      const events = await device.getEventsForDay(branch, date);
      const people = att.summariseDay(events, { viewingToday: true });
      const { alerts } = att.evaluateDay(branch.id, people, branch.tzOffset);
      return sendJSON(res, 200, {
        date, branch: branch.id,
        onSite: people.filter((p) => p.onSite).length,
        open: people.some((p) => p.onSite),
        peopleToday: people.length,
        punches: events.length,
        people: people.map((p) => slimPerson(p, branch.tzOffset)),
        alerts: alerts.map((a) => ({ ...a, at: clockIn(a.at, branch.tzOffset) })),
      });
    }

    // History for a specific day
    if (route === '/api/history') {
      const date = q.get('date') || device.todayInTz(branch.tzOffset);
      const isToday = date === device.todayInTz(branch.tzOffset);
      const events = await device.getEventsForDay(branch, date);
      const people = att.summariseDay(events, { viewingToday: isToday });
      att.evaluateDay(branch.id, people, branch.tzOffset);
      return sendJSON(res, 200, { date, branch: branch.id, count: events.length, people: people.map((p) => slimPerson(p, branch.tzOffset)) });
    }

    // Monthly metrics per employee
    if (route === '/api/metrics') {
      const month = q.get('month') || device.todayInTz(branch.tzOffset).slice(0, 7);
      const today = device.todayInTz(branch.tzOffset);
      const dates = daysInMonth(month).filter((d) => d <= today);
      const days = [];
      for (const date of dates) {
        const events = await device.getEventsForDay(branch, date);
        const people = att.summariseDay(events, { viewingToday: date === today });
        att.evaluateDay(branch.id, people, branch.tzOffset);
        days.push({ date, isToday: date === today, people });
      }
      return sendJSON(res, 200, { month, branch: branch.id, warehouse: att.warehouseMonthly(days, branch.tzOffset), employees: att.monthlyMetrics(branch.id, days, branch.tzOffset) });
    }

    // Camera list: manual override if provided, else auto-discover from the device
    if (route === '/api/cameras') {
      if (branch.cameras && branch.cameras.length) {
        return sendJSON(res, 200, { branch: branch.id, source: 'manual', cameras: branch.cameras });
      }
      try {
        const cams = await device.listChannels(branch.camera);
        return sendJSON(res, 200, { branch: branch.id, source: 'auto', cameras: cams });
      } catch (e) {
        return sendJSON(res, 200, { branch: branch.id, source: 'auto', cameras: [], error: e.message });
      }
    }

    // Camera snapshot proxy (from the branch's camera source)
    if (route === '/api/snapshot') {
      const channel = q.get('channel') || '101';
      const r = await device.snapshot(branch.camera, channel);
      if (r.statusCode !== 200) return sendJSON(res, r.statusCode, { error: `Device HTTP ${r.statusCode}` });
      res.writeHead(200, { 'Content-Type': r.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(r.buffer);
    }

    // Schedules
    if (route === '/api/schedules' && req.method === 'GET') return sendJSON(res, 200, store.getSchedules(branch.id));
    if (route === '/api/schedules' && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, store.saveSchedules(branch.id, body));
    }

    // Notification rules (global)
    if (route === '/api/notifications' && req.method === 'GET') return sendJSON(res, 200, store.getNotifications());
    if (route === '/api/notifications' && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, store.saveNotifications(body));
    }

    // Door (optional, disabled by default)
    if (route === '/api/door' && req.method === 'POST') {
      if (!settings.enableDoors) return sendJSON(res, 403, { error: 'Door control is disabled' });
      const { doorNo, cmd } = await readBody(req);
      const r = await device.controlDoor(branch, doorNo, cmd || 'open');
      return sendJSON(res, r.statusCode === 200 ? 200 : 502, { statusCode: r.statusCode });
    }

    // ---- static ----
    let file = route === '/' ? '/index.html' : route;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    if (serveFile(res, file)) return;
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

function clockIn(date, tzOffset) {
  if (!date) return null;
  const sign = tzOffset[0] === '-' ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(':').map(Number);
  const s = new Date(date.getTime() + sign * ((h * 60 + m) * 60000));
  return `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`;
}
function slimPerson(p, tz = '+00:00') {
  return {
    employeeNo: p.employeeNo, name: p.name, id: p.id,
    onSite: p.onSite,
    firstIn: clockIn(p.firstIn, tz),
    lastOut: clockIn(p.lastOut, tz),
    totalMs: p.totalMs,
    late: !!p.late, lateBy: p.lateBy || 0,
    leftEarly: !!p.leftEarly, earlyBy: p.earlyBy || 0,
    punches: p.punches.map((k) => ({ clock: clockIn(k.time, tz), dir: k.dir })),
    schedule: p.schedule || null,
  };
}

server.listen(settings.port, () => {
  console.log(`storage.ae warehouse ops on port ${settings.port}`);
  console.log(`Branches: ${settings.branches.map((b) => `${b.name} (${b.host || 'no host'})`).join(', ')}`);
  console.log(`Doors: ${settings.enableDoors ? 'ENABLED' : 'disabled'}`);
});
