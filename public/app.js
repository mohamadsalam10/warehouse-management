'use strict';
const $ = (s, r = document) => r.querySelector(s);
const state = { branch: null, city: null, view: 'overview', config: null, overview: null, camTimer: null };

// ---------- helpers ----------
async function api(path) {
  const r = await fetch(path);
  if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
async function apiPut(path, body) {
  const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Save failed');
  return d;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function hhmm(iso) { if (!iso) return null; const d = new Date(iso); return d.toTimeString().slice(0, 5); }
function fmtDur(ms) { if (!ms || ms <= 0) return '0h'; const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; }
function fmtMins(min) { if (!min) return ''; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${m}m` : `${m}m`; }
function todayLocal() { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d - off * 60000).toISOString().slice(0, 10); }
function monthLocal() { return todayLocal().slice(0, 7); }
const b = () => `branch=${encodeURIComponent(state.branch)}`;

function setConn(ok, msg) { $('#conn').textContent = ok ? `Connected · ${new Date().toTimeString().slice(0, 5)}` : (msg || 'Offline'); $('#conn').style.color = ok ? 'var(--color-success)' : 'var(--color-danger)'; }
function errBox(msg) { return `<div class="panel"><div class="err"><h3>Can't reach the device</h3><p class="note-inline">${esc(msg)}</p><p class="note-inline">Check the branch is online and reachable at its configured address.</p></div></div>`; }

// ---------- OVERVIEW (command centre) ----------
async function renderOverview() {
  const root = $('#view-overview');
  root.innerHTML = `<div class="hero"><div class="eyebrow">Command centre</div><div class="status-line"><h2>Loading…</h2></div></div>`;
  try {
    const d = await api('/api/overview');
    state.overview = d;
    paintBranchStatuses(); // refresh sidebar dots from the same data
    const rows = d.branches.filter((x) => x.city === state.city);
    const open = rows.filter((r) => r.open).length;
    const staff = rows.reduce((s, r) => s + r.onSite, 0);
    const totalAlerts = rows.reduce((s, x) => s + x.alerts, 0);
    const openTxt = `${open} of ${rows.length} ${rows.length === 1 ? 'branch' : 'branches'} open`;
    root.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Command centre · ${esc(state.city)}</div>
        <div class="status-line"><h2>${staff} on site now</h2></div>
        <div class="sub">${openTxt} · live across ${esc(state.city)}</div>
        <div class="hero-stats">
          <div><div class="hs-k">Branches open</div><div class="hs-v">${open}/${rows.length}</div></div>
          <div><div class="hs-k">Staff on site</div><div class="hs-v">${staff}</div></div>
          <div><div class="hs-k">Open alerts</div><div class="hs-v">${totalAlerts}</div></div>
        </div>
      </div>
      <div class="eyebrow" style="margin-bottom:12px">Branches in ${esc(state.city)}</div>
      <div class="branch-grid">${rows.length ? rows.map(branchCard).join('') : '<div class="note-inline">No branches in this city.</div>'}</div>`;
    root.querySelectorAll('.branch-card').forEach((c) => c.addEventListener('click', () => selectBranch(c.dataset.id, 'live')));
  } catch (e) { if (e.message !== 'unauth') root.innerHTML = errBox(e.message); }
}
function branchCard(x) {
  const cls = !x.ok ? 'err' : (x.open ? 'open' : (x.alerts ? 'alert' : ''));
  const status = !x.ok
    ? `<span class="status-pill closed"><span class="d"></span>Offline</span>`
    : (x.open ? `<span class="status-pill open"><span class="d"></span>Open</span>` : `<span class="status-pill closed"><span class="d"></span>Closed</span>`);
  return `<button class="branch-card ${cls}" data-id="${esc(x.id)}" data-name="${esc(x.name)}">
    <div class="top"><div class="bname">${esc(x.name)}</div>${status}</div>
    <div class="metrics">
      <div class="m"><div class="k">On site</div><div class="v">${x.onSite}</div></div>
      <div class="m"><div class="k">Today</div><div class="v">${x.peopleToday}</div></div>
      <div class="m"><div class="k">Alerts</div><div class="v">${x.alerts}</div></div>
    </div></button>`;
}

// ---------- LIVE ----------
async function renderLive() {
  const root = $('#view-live');
  root.innerHTML = `<div class="hero"><div class="eyebrow">Live status</div><div class="status-line"><h2>Loading…</h2></div></div>`;
  try {
    const d = await api(`/api/live?${b()}`);
    setConn(true);
    setBranchStatus(d.open);
    const onSite = d.people.filter((p) => p.onSite);
    let html = `<div class="hero ${d.open ? '' : 'closed'}">
      <div class="eyebrow">${esc(currentBranchName())} · live status</div>
      <div class="status-line">
        <h2>${d.open ? 'Open' : 'Closed'}</h2>
        <span class="pill-on-hero"><span class="d"></span>${d.onSite} on site</span>
      </div>
      <div class="sub">${d.open ? `${d.onSite} ${d.onSite === 1 ? 'person is' : 'people are'} on site right now` : 'Nobody is on site right now'}</div>
      <div class="hero-stats">
        <div><div class="hs-k">People today</div><div class="hs-v">${d.peopleToday}</div></div>
        <div><div class="hs-k">Punches today</div><div class="hs-v">${d.punches}</div></div>
        <div><div class="hs-k">Alerts today</div><div class="hs-v">${d.alerts.length}</div></div>
      </div>
    </div>`;

    html += `<div class="panel"><div class="head"><h2>On site now</h2><span class="sub">${onSite.length} present</span></div>`;
    if (!onSite.length) html += `<div class="empty"><h3>Nobody on site</h3><p>Punches will appear here as employees badge in.</p></div>`;
    else {
      html += `<table><thead><tr><th>Employee</th><th>Since</th><th>On site</th><th>Status</th></tr></thead><tbody>`;
      for (const p of onSite) html += `<tr><td class="emp"><div class="name">${esc(p.name)}</div><div class="id mono">${esc(p.id)}</div></td>
        <td class="num">${p.firstIn || "—"}</td><td class="num">${fmtDur(p.totalMs)}</td>
        <td>${p.late ? `<span class="badge late"><span class="dot"></span>Late ${fmtMins(p.lateBy)}</span>` : `<span class="badge on"><span class="dot"></span>On time</span>`}</td></tr>`;
      html += `</tbody></table>`;
    }
    html += `</div>`;

    html += `<div class="panel"><div class="head"><h2>Today's alerts</h2><span class="sub">${d.alerts.length}</span></div>`;
    if (!d.alerts.length) html += `<div class="empty"><h3>No alerts</h3><p>Late arrivals and early exits will show up here.</p></div>`;
    else for (const a of d.alerts) {
      const late = a.type === 'late';
      html += `<div class="alert-row"><div class="ico ${late ? 'late' : 'early'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg></div>
        <div><span class="who">${esc(a.name)}</span> ${late ? `arrived ${fmtMins(a.minutes)} late` : `left ${fmtMins(a.minutes)} early`} <span class="note-inline">· ${a.at}</span></div></div>`;
    }
    html += `</div>`;
    root.innerHTML = html;
  } catch (e) { if (e.message !== 'unauth') { setConn(false, 'Connection error'); root.innerHTML = errBox(e.message); } }
}

// ---------- HISTORY ----------
async function renderHistory() {
  const root = $('#view-history');
  if (!root.dataset.init) {
    root.innerHTML = `<div class="row-controls"><label class="field">Day<input type="date" id="hist-date" value="${todayLocal()}" max="${todayLocal()}"></label></div><div id="hist-body"></div>`;
    root.dataset.init = '1';
    $('#hist-date').addEventListener('change', loadHistory);
  }
  loadHistory();
}
async function loadHistory() {
  const date = $('#hist-date').value || todayLocal();
  const body = $('#hist-body'); body.innerHTML = `<div class="panel"><div class="empty">Loading…</div></div>`;
  try {
    const d = await api(`/api/history?${b()}&date=${date}`);
    if (!d.people.length) { body.innerHTML = `<div class="panel"><div class="empty"><h3>No punches for this day</h3><p>Pick another day, or check the branch was open.</p></div></div>`; return; }
    let html = `<div class="panel"><div class="head"><h2>${date}</h2><span class="sub">${d.people.length} people · ${d.count} punches</span></div>
      <table><thead><tr><th>Employee</th><th>Status</th><th>Arrived</th><th>Last out</th><th>Hours</th><th>Flags</th><th></th></tr></thead><tbody>`;
    d.people.forEach((p, i) => {
      const status = p.onSite ? `<span class="badge on"><span class="dot"></span>On site</span>` : `<span class="badge off"><span class="dot"></span>Off site</span>`;
      const flags = [p.late ? `<span class="badge late">Late ${fmtMins(p.lateBy)}</span>` : '', p.leftEarly ? `<span class="badge early">Early ${fmtMins(p.earlyBy)}</span>` : ''].filter(Boolean).join(' ') || '<span class="note-inline">—</span>';
      html += `<tr class="clickable" data-i="${i}"><td class="emp"><div class="name">${esc(p.name)}</div><div class="id mono">${esc(p.id)}</div></td>
        <td>${status}</td><td class="num">${p.firstIn || "—"}</td><td class="num">${p.lastOut || "—"}</td><td class="num">${fmtDur(p.totalMs)}</td><td>${flags}</td>
        <td><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></td></tr>
        <tr class="detail" data-d="${i}" style="display:none"><td colspan="7"><div class="punch-seq">${p.punches.map((k) => `<span class="punch"><span class="tag ${k.dir}">${k.dir.toUpperCase()}</span><span class="mono">${k.clock}</span></span>`).join('')}</div></td></tr>`;
    });
    html += `</tbody></table></div>`;
    body.innerHTML = html;
    body.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => {
      const det = body.querySelector(`tr.detail[data-d="${tr.dataset.i}"]`);
      det.style.display = det.style.display === 'none' ? 'table-row' : 'none';
    }));
  } catch (e) { if (e.message !== 'unauth') body.innerHTML = errBox(e.message); }
}

// ---------- EMPLOYEES (metrics) ----------
async function renderEmployees() {
  const root = $('#view-employees');
  if (!root.dataset.init) {
    root.innerHTML = `<div class="row-controls"><label class="field">Month<input type="month" id="emp-month" value="${monthLocal()}" max="${monthLocal()}"></label>
      <span class="note-inline">First load fetches the month from the device and can take a moment.</span></div><div id="emp-body"></div>`;
    root.dataset.init = '1';
    $('#emp-month').addEventListener('change', loadEmployees);
  }
  loadEmployees();
}
async function loadEmployees() {
  const month = $('#emp-month').value || monthLocal();
  const body = $('#emp-body'); body.innerHTML = `<div class="panel"><div class="empty">Building metrics for ${month}…</div></div>`;
  try {
    const d = await api(`/api/metrics?${b()}&month=${month}`);
    const w = d.warehouse || {};
    let html = `<div class="eyebrow" style="margin-bottom:10px">Warehouse this month</div>
      <div class="wh-grid">
        <div class="stat"><div class="k">Days opened</div><div class="n mid">${w.daysOpened || 0}</div></div>
        <div class="stat"><div class="k">Avg opening</div><div class="n mid mono">${w.avgOpen || '—'}</div></div>
        <div class="stat"><div class="k">Avg closing</div><div class="n mid mono">${w.avgClose || '—'}</div></div>
        <div class="stat"><div class="k">Avg hours/day</div><div class="n mid">${w.avgHoursPerDay || 0}h</div></div>
        <div class="stat"><div class="k">Total hours</div><div class="n mid">${w.totalHours || 0}h</div></div>
      </div>`;

    if (!d.employees.length) { body.innerHTML = html + `<div class="panel"><div class="empty"><h3>No employee data for ${esc(month)}</h3><p>Pick another month.</p></div></div>`; return; }
    html += `<div class="panel"><div class="head"><h2>Per-employee metrics</h2><span class="sub">${month} · ${d.employees.length} employees</span></div>
      <table><thead><tr><th>Employee</th><th>Days present</th><th>Avg in</th><th>Avg out</th><th>Avg hrs/day</th><th>Times late</th><th>Left early</th></tr></thead><tbody>`;
    for (const e of d.employees) {
      html += `<tr><td class="emp"><div class="name">${esc(e.name)}</div><div class="id mono">${esc(e.id)}</div></td>
        <td class="num">${e.daysPresent}</td><td class="num">${e.avgIn || '—'}</td><td class="num">${e.avgOut || '—'}</td><td class="num">${e.avgHours}h</td>
        <td>${e.lateCount ? `<span class="badge late">${e.lateCount}</span>` : `<span class="note-inline">0</span>`}</td>
        <td>${e.earlyLeaveCount ? `<span class="badge early">${e.earlyLeaveCount}</span>` : `<span class="note-inline">0</span>`}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    body.innerHTML = html;
  } catch (e) { if (e.message !== 'unauth') body.innerHTML = errBox(e.message); }
}

// ---------- CAMERAS ----------
async function renderCameras() {
  const root = $('#view-cameras');
  root.innerHTML = `<div class="panel"><div class="empty">Finding cameras on this branch…</div></div>`;
  let cams = [];
  try {
    const d = await api(`/api/cameras?${b()}`);
    cams = d.cameras || [];
  } catch (e) { if (e.message === 'unauth') return; root.innerHTML = errBox(e.message); return; }

  if (!cams.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><h3>No cameras found on this branch's device</h3>
      <p>The device didn't return any camera channels. If your CCTV is on a separate recorder, point this branch's camera source at it, and the cameras will list here automatically.</p></div></div>`;
    return;
  }
  root.innerHTML = `<div class="row-controls"><span class="note-inline">${cams.length} camera${cams.length > 1 ? 's' : ''} · live snapshots · click a camera to zoom and expand</span></div>
    <div class="cam-grid">${cams.map((c) => `<div class="cam" data-ch="${esc(c.channel)}" data-label="${esc(c.label)}"><div class="frame" data-ch="${esc(c.channel)}"><span>Loading…</span></div>
    <div class="bar"><b>${esc(c.label)}</b><span class="live"><span class="dot"></span>Live</span></div></div>`).join('')}</div>`;
  root.querySelectorAll('.cam').forEach((cam) => cam.addEventListener('click', () => openViewer(cam.dataset.ch, cam.dataset.label)));
  refreshCams();
  clearInterval(state.camTimer);
  state.camTimer = setInterval(() => { if (state.view === 'cameras' && !viewer.open) refreshCams(); }, 3000);
}
function refreshCams() {
  document.querySelectorAll('#view-cameras .frame').forEach((f) => {
    const img = new Image();
    img.onload = () => { f.innerHTML = ''; f.appendChild(img); };
    img.onerror = () => { if (!f.querySelector('img')) f.innerHTML = `<span>No image · check channel ${esc(f.dataset.ch)}</span>`; };
    img.src = `/api/snapshot?${b()}&channel=${encodeURIComponent(f.dataset.ch)}&t=${Date.now()}`;
  });
}

// ---------- CAMERA VIEWER (zoom / pan / fullscreen / pause / save) ----------
const viewer = { open: false, el: null, img: null, stage: null, ch: null, label: null, scale: 1, tx: 0, ty: 0, timer: null, paused: false, drag: null };
function buildViewer() {
  if (viewer.el) return;
  const el = document.createElement('div');
  el.className = 'cam-viewer';
  el.innerHTML = `
    <div class="cv-top"><b id="cv-label"></b><span class="live" style="color:rgb(255 255 255 / 70%);font-size:.75rem;display:inline-flex;align-items:center;gap:6px"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:var(--color-success)"></span><span id="cv-livetxt">Live</span></span>
      <button class="cv-btn cv-close" id="cv-close" title="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>
    <div class="cv-stage" id="cv-stage"><img class="cv-img" id="cv-img" alt=""></div>
    <div class="cv-bar">
      <button class="cv-btn" id="cv-out" title="Zoom out"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.3-4.3"/></svg></button>
      <span class="cv-zoom" id="cv-zoom">100%</span>
      <button class="cv-btn" id="cv-in" title="Zoom in"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4.3-4.3"/></svg></button>
      <button class="cv-btn wide" id="cv-reset">Reset</button>
      <button class="cv-btn wide" id="cv-pause" title="Pause live"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg> Pause</button>
      <button class="cv-btn wide" id="cv-full" title="Fullscreen"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg> Fullscreen</button>
      <button class="cv-btn wide" id="cv-save" title="Save this frame"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Save frame</button>
    </div>`;
  document.body.appendChild(el);
  viewer.el = el; viewer.img = el.querySelector('#cv-img'); viewer.stage = el.querySelector('#cv-stage');

  el.querySelector('#cv-close').addEventListener('click', closeViewer);
  el.querySelector('#cv-in').addEventListener('click', () => zoomBy(1.3));
  el.querySelector('#cv-out').addEventListener('click', () => zoomBy(1 / 1.3));
  el.querySelector('#cv-reset').addEventListener('click', () => { viewer.scale = 1; viewer.tx = 0; viewer.ty = 0; applyCV(); });
  el.querySelector('#cv-pause').addEventListener('click', togglePause);
  el.querySelector('#cv-full').addEventListener('click', () => { if (!document.fullscreenElement) viewer.el.requestFullscreen?.(); else document.exitFullscreen?.(); });
  el.querySelector('#cv-save').addEventListener('click', saveFrame);

  // wheel zoom (anchored to cursor)
  viewer.stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  // drag pan
  viewer.stage.addEventListener('pointerdown', (e) => { if (viewer.scale <= 1) return; viewer.drag = { x: e.clientX, y: e.clientY, tx: viewer.tx, ty: viewer.ty }; viewer.stage.classList.add('grabbing'); viewer.stage.setPointerCapture(e.pointerId); });
  viewer.stage.addEventListener('pointermove', (e) => { if (!viewer.drag) return; viewer.tx = viewer.drag.tx + (e.clientX - viewer.drag.x); viewer.ty = viewer.drag.ty + (e.clientY - viewer.drag.y); applyCV(); });
  const endDrag = () => { viewer.drag = null; viewer.stage.classList.remove('grabbing'); };
  viewer.stage.addEventListener('pointerup', endDrag);
  viewer.stage.addEventListener('pointercancel', endDrag);
  // pinch zoom (two-pointer)
  const pts = new Map(); let pinchDist = 0;
  viewer.stage.addEventListener('pointerdown', (e) => pts.set(e.pointerId, e));
  viewer.stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
    if (pts.size === 2) { const [a, c] = [...pts.values()]; const d = Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY); if (pinchDist) zoomBy(d / pinchDist, (a.clientX + c.clientX) / 2, (a.clientY + c.clientY) / 2); pinchDist = d; }
  });
  const clr = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinchDist = 0; };
  viewer.stage.addEventListener('pointerup', clr); viewer.stage.addEventListener('pointercancel', clr);
  document.addEventListener('keydown', (e) => { if (viewer.open && e.key === 'Escape' && !document.fullscreenElement) closeViewer(); });
}
function applyCV() {
  viewer.img.style.transform = `translate(${viewer.tx}px, ${viewer.ty}px) scale(${viewer.scale})`;
  viewer.el.querySelector('#cv-zoom').textContent = Math.round(viewer.scale * 100) + '%';
  if (viewer.scale <= 1) { viewer.tx = 0; viewer.ty = 0; viewer.img.style.transform = 'translate(0,0) scale(1)'; }
}
function zoomBy(factor, cx, cy) {
  const s0 = viewer.scale;
  const s1 = Math.min(8, Math.max(1, s0 * factor));
  if (s1 === s0) return;
  if (cx != null) {
    const r = viewer.stage.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
    viewer.tx = ox - ((ox - viewer.tx) / s0) * s1;
    viewer.ty = oy - ((oy - viewer.ty) / s0) * s1;
  }
  viewer.scale = s1; applyCV();
}
function cvSnapshotUrl() { return `/api/snapshot?${b()}&channel=${encodeURIComponent(viewer.ch)}&t=${Date.now()}`; }
function cvRefresh() {
  if (viewer.paused) return;
  const img = new Image();
  img.onload = () => { if (viewer.open && !viewer.paused) viewer.img.src = img.src; };
  img.src = cvSnapshotUrl();
}
function togglePause() {
  viewer.paused = !viewer.paused;
  viewer.el.querySelector('#cv-pause').innerHTML = viewer.paused
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 3l14 9-14 9z"/></svg> Resume`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg> Pause`;
  viewer.el.querySelector('#cv-livetxt').textContent = viewer.paused ? 'Paused' : 'Live';
}
async function saveFrame() {
  try {
    const r = await fetch(cvSnapshotUrl()); const blob = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${viewer.label || 'camera'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* ignore */ }
}
function openViewer(ch, label) {
  buildViewer();
  viewer.ch = ch; viewer.label = label; viewer.open = true; viewer.paused = false;
  viewer.scale = 1; viewer.tx = 0; viewer.ty = 0; applyCV();
  viewer.el.querySelector('#cv-label').textContent = label;
  viewer.el.querySelector('#cv-livetxt').textContent = 'Live';
  viewer.img.src = cvSnapshotUrl();
  viewer.el.classList.add('open');
  clearInterval(viewer.timer);
  viewer.timer = setInterval(cvRefresh, 1500);
}
function closeViewer() {
  viewer.open = false;
  clearInterval(viewer.timer);
  if (document.fullscreenElement) document.exitFullscreen?.();
  viewer.el.classList.remove('open');
}

// ---------- SETTINGS ----------
async function renderSettings() {
  const root = $('#view-settings');
  root.innerHTML = `<div class="panel"><div class="empty">Loading settings…</div></div>`;
  try {
    const [sched, notif] = await Promise.all([api(`/api/schedules?${b()}`), api('/api/notifications')]);
    const branchRows = (state.config?.branches || []).map((br) => `
      <div class="sched-row" style="grid-template-columns:1fr 1fr 1fr">
        <input value="${esc(br.name)}" data-bm-name="${esc(br.id)}">
        <input value="${esc(br.city)}" data-bm-city="${esc(br.id)}" list="city-options">
        <span class="note-inline mono" style="align-self:center">${esc(br.id)}</span>
      </div>`).join('');
    const cityOpts = [...new Set((state.config?.cities || []))].map((c) => `<option value="${esc(c)}">`).join('');
    root.innerHTML = `
      <div class="panel"><div class="head"><h2>Branches and cities</h2><span class="sub">Group branches into cities for the top bar</span></div>
        <div style="padding: var(--space-6)">
          <datalist id="city-options">${cityOpts}</datalist>
          <div class="sched-row" style="grid-template-columns:1fr 1fr 1fr"><span class="eyebrow">Display name</span><span class="eyebrow">City</span><span class="eyebrow">Branch id</span></div>
          <div id="branch-rows">${branchRows || '<div class="note-inline">Branches come from your deploy configuration. Add them there, then set their city here.</div>'}</div>
          <div style="margin-top:var(--space-4)"><button class="btn primary" id="save-branches">Save branches</button> <span class="note-inline" id="branches-msg"></span></div>
          <p class="note-inline" style="margin-top:var(--space-3)">Type a new city name to create it. The top-bar dropdown lists whatever cities you use here.</p>
        </div>
      </div>

      <div class="panel"><div class="head"><h2>Working hours</h2><span class="sub">Used to flag late arrivals and early exits</span></div>
        <div style="padding: var(--space-6)">
          <div class="eyebrow" style="margin-bottom:8px">Default (everyone)</div>
          <div class="grid-2" style="max-width:520px">
            <label class="field">Start<input type="time" id="def-start" value="${sched.default.start}"></label>
            <label class="field">End<input type="time" id="def-end" value="${sched.default.end}"></label>
          </div>
          <label class="field" style="max-width:250px;margin-top:var(--space-4)">Grace period (minutes)<input type="number" id="def-grace" min="0" value="${sched.default.graceMinutes}"><span class="hint">Minutes after start before someone counts as late</span></label>

          <div class="eyebrow" style="margin:var(--space-8) 0 8px">Per-employee overrides</div>
          <div class="sched-row"><span class="eyebrow">Employee ID</span><span class="eyebrow">Start</span><span class="eyebrow">End</span><span class="eyebrow">Grace</span><span></span></div>
          <div id="ovr-rows"></div>
          <button class="btn" id="add-ovr" style="margin-top:var(--space-2)">+ Add employee</button>
          <div style="margin-top:var(--space-6)"><button class="btn primary" id="save-sched">Save hours</button> <span class="note-inline" id="sched-msg"></span></div>
        </div>
      </div>

      <div class="panel"><div class="head"><h2>Notifications</h2><span class="sub">Choose what you get told about</span></div>
        <div style="padding: var(--space-6); display:flex; flex-direction:column; gap:var(--space-4); max-width:560px">
          <label class="toggle"><input type="checkbox" id="n-late" ${notif.lateArrival ? 'checked' : ''}> Employee arrives late</label>
          <label class="toggle"><input type="checkbox" id="n-early" ${notif.earlyLeave ? 'checked' : ''}> Employee leaves early</label>
          <label class="toggle"><input type="checkbox" id="n-absent" ${notif.absence ? 'checked' : ''}> Employee is absent (no punch by start)</label>
          <div class="grid-2" style="margin-top:var(--space-2)">
            <label class="field">Send to (channel)<select id="n-channel">
              <option value="whatsapp" ${notif.manager.channel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
              <option value="sms" ${notif.manager.channel === 'sms' ? 'selected' : ''}>SMS</option>
              <option value="email" ${notif.manager.channel === 'email' ? 'selected' : ''}>Email</option>
            </select></label>
            <label class="field">Your contact<input type="text" id="n-to" value="${esc(notif.manager.to)}" placeholder="e.g. +9715…"></label>
          </div>
          <p class="note-inline">Detection runs now and shows on the Live tab. Actual sending gets switched on when we connect Respond and message templates.</p>
          <div><button class="btn primary" id="save-notif">Save notifications</button> <span class="note-inline" id="notif-msg"></span></div>
        </div>
      </div>`;

    const ovr = $('#ovr-rows');
    const addRow = (id = '', s = '', e = '', g = '') => {
      const div = document.createElement('div'); div.className = 'sched-row';
      div.innerHTML = `<input placeholder="1001" value="${esc(id)}"><input type="time" value="${s}"><input type="time" value="${e}"><input type="number" min="0" placeholder="${sched.default.graceMinutes}" value="${g}">
        <button class="btn" title="Remove">×</button>`;
      div.querySelector('button').addEventListener('click', () => div.remove());
      ovr.appendChild(div);
    };
    Object.entries(sched.byEmployee || {}).forEach(([id, v]) => addRow(id, v.start || '', v.end || '', v.graceMinutes ?? ''));
    $('#add-ovr').addEventListener('click', () => addRow());

    $('#save-sched').addEventListener('click', async () => {
      const byEmployee = {};
      ovr.querySelectorAll('.sched-row').forEach((r) => {
        const [id, s, e, g] = [...r.querySelectorAll('input')].map((i) => i.value.trim());
        if (id) byEmployee[id] = { start: s || sched.default.start, end: e || sched.default.end, graceMinutes: Number(g || sched.default.graceMinutes) };
      });
      const payload = { default: { start: $('#def-start').value, end: $('#def-end').value, graceMinutes: Number($('#def-grace').value) }, byEmployee };
      try { await apiPut(`/api/schedules?${b()}`, payload); $('#sched-msg').textContent = 'Saved'; $('#sched-msg').style.color = 'var(--color-success)'; }
      catch (err) { $('#sched-msg').textContent = err.message; $('#sched-msg').style.color = 'var(--color-danger)'; }
    });

    $('#save-notif').addEventListener('click', async () => {
      const payload = { lateArrival: $('#n-late').checked, earlyLeave: $('#n-early').checked, absence: $('#n-absent').checked, manager: { channel: $('#n-channel').value, to: $('#n-to').value.trim() } };
      try { await apiPut('/api/notifications', payload); $('#notif-msg').textContent = 'Saved'; $('#notif-msg').style.color = 'var(--color-success)'; }
      catch (err) { $('#notif-msg').textContent = err.message; $('#notif-msg').style.color = 'var(--color-danger)'; }
    });

    const saveBranchesBtn = $('#save-branches');
    if (saveBranchesBtn) saveBranchesBtn.addEventListener('click', async () => {
      const msg = $('#branches-msg');
      try {
        for (const inp of document.querySelectorAll('[data-bm-name]')) {
          const id = inp.dataset.bmName;
          const name = inp.value.trim();
          const city = (document.querySelector(`[data-bm-city="${CSS.escape(id)}"]`).value || '').trim() || 'Dubai';
          await apiPut('/api/branchmeta', { id, name, city });
        }
        // reload config so the city dropdown + sidebar reflect the changes
        state.config = await api('/api/config');
        const cities = state.config.cities.length ? state.config.cities : ['Dubai'];
        $('#city').innerHTML = cities.map((c) => `<option value="${esc(c)}"${c === state.city ? ' selected' : ''}>${esc(c)}</option>`).join('');
        if (!cities.includes(state.city)) { state.city = cities[0]; $('#city').value = state.city; }
        buildBranchNav();
        updateCrumb();
        msg.textContent = 'Saved'; msg.style.color = 'var(--color-success)';
      } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--color-danger)'; }
    });
  } catch (e) { if (e.message !== 'unauth') root.innerHTML = errBox(e.message); }
}

// ---------- helpers for status + clock ----------
function currentBranchName() {
  const br = (state.config?.branches || []).find((x) => x.id === state.branch);
  return br ? br.name : '';
}
function setBranchStatus(open) {
  const pill = $('#branch-status');
  pill.style.display = 'inline-flex';
  pill.className = 'status-pill ' + (open ? 'open' : 'closed');
  $('#branch-status-text').textContent = open ? 'Open' : 'Closed';
}
function tickClock() {
  // Gulf Standard Time (UTC+4), independent of the viewer's device clock
  const now = new Date();
  const gst = new Date(now.getTime() + (now.getTimezoneOffset() + 240) * 60000);
  $('#clock').textContent = gst.toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000); tickClock();

function branchesInCity() {
  return (state.config?.branches || []).filter((x) => x.city === state.city);
}
function updateCrumb() {
  const name = currentBranchName();
  const isBranchView = BRANCH_VIEWS.has(state.view);
  $('#crumb').innerHTML = isBranchView && name
    ? `<b>${esc(name)}</b> · ${TITLES[state.view]}`
    : TITLES[state.view];
}

// Build the sidebar branch list for the selected city.
function buildBranchNav() {
  $('#city-label').textContent = state.city;
  const list = branchesInCity();
  const nav = $('#branch-nav');
  if (!list.length) { nav.innerHTML = `<div class="note-inline" style="padding:6px 12px">No branches in this city yet.</div>`; return; }
  nav.innerHTML = list.map((br) => `<button class="branch-item ${br.id === state.branch ? 'active' : ''}" data-id="${esc(br.id)}">
    <span class="bdot" data-dot="${esc(br.id)}"></span><span class="bname">${esc(br.name)}</span><span class="bcount" data-count="${esc(br.id)}"></span>
  </button>`).join('');
  nav.querySelectorAll('.branch-item').forEach((el) => el.addEventListener('click', () => selectBranch(el.dataset.id)));
  paintBranchStatuses();
}
function selectBranch(id, view) {
  state.branch = id;
  document.querySelectorAll('.branch-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  go(view || (BRANCH_VIEWS.has(state.view) ? state.view : 'live'));
}
// Fetch open/closed + on-site once and paint the sidebar dots/counts.
async function paintBranchStatuses() {
  try {
    const d = await api('/api/overview');
    state.overview = d;
    for (const r of d.branches) {
      const dot = document.querySelector(`.bdot[data-dot="${CSS.escape(r.id)}"]`);
      const cnt = document.querySelector(`.bcount[data-count="${CSS.escape(r.id)}"]`);
      if (dot) dot.classList.toggle('open', r.open);
      if (cnt) cnt.textContent = r.onSite ? String(r.onSite) : '';
    }
  } catch { /* nav still works without live dots */ }
}

// ---------- routing ----------
const TITLES = { overview: 'Overview', live: 'Live', history: 'History', employees: 'Employees', cameras: 'Cameras', settings: 'Settings' };
const RENDER = { overview: renderOverview, live: renderLive, history: renderHistory, employees: renderEmployees, cameras: renderCameras, settings: renderSettings };
// Views that are about one branch show the Open/Closed pill; company-wide/config views don't.
const BRANCH_VIEWS = new Set(['live', 'history', 'employees', 'cameras']);
function go(view) {
  state.view = view;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $('#branch-status').style.display = 'none'; // renderLive re-shows it with real state
  updateCrumb();
  if (view !== 'cameras') clearInterval(state.camTimer);
  RENDER[view]();
}

document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.view); }));
$('#refresh').addEventListener('click', () => { $('#reficon').classList.add('spin'); RENDER[state.view](); if (state.view !== 'overview') paintBranchStatuses(); setTimeout(() => $('#reficon').classList.remove('spin'), 500); });
$('#city').addEventListener('change', (e) => {
  state.city = e.target.value;
  const list = branchesInCity();
  state.branch = list[0]?.id || null;
  buildBranchNav();
  go(state.view === 'overview' ? 'overview' : 'live');
});

(async function init() {
  try {
    state.config = await api('/api/config');
    const cities = state.config.cities && state.config.cities.length ? state.config.cities : ['Dubai'];
    $('#city').innerHTML = cities.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    state.city = cities[0];
    state.branch = branchesInCity()[0]?.id || state.config.branches[0]?.id || null;
    buildBranchNav();
    go('overview');
  } catch (e) { if (e.message !== 'unauth') $('#view-overview').innerHTML = errBox(e.message); }
})();
