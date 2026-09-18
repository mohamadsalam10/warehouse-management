'use strict';
const store = require('./store');

// Parse a device timestamp; return a Date or null.
function parseTime(t) { const d = new Date(t); return isNaN(d) ? null : d; }

// Minutes since midnight at a given UTC offset (e.g. "+04:00"), so late/early
// checks use the branch's wall-clock, not the server's timezone.
function minutesOf(date, tzOffset = '+00:00') {
  const sign = tzOffset[0] === '-' ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(':').map(Number);
  const shifted = new Date(date.getTime() + sign * ((h * 60 + m) * 60000));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
function hhmmToMinutes(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); }

// Group one day's raw events into per-employee records with in/out inference.
function summariseDay(events, { viewingToday = false } = {}) {
  const map = new Map();
  for (const e of events) {
    const t = parseTime(e.time);
    if (!t) continue;
    const key = e.employeeNo || e.name || e.cardNo || 'unknown';
    if (!map.has(key)) map.set(key, { key, employeeNo: e.employeeNo || '', name: e.name || '(no name)', id: e.employeeNo || e.cardNo || '—', punches: [] });
    map.get(key).punches.push({ time: t, status: e.attendanceStatus });
  }

  const people = [];
  for (const p of map.values()) {
    p.punches.sort((a, b) => a.time - b.time);
    let expectIn = true;
    for (const pk of p.punches) {
      const s = (pk.status || '').toLowerCase();
      if (s.includes('checkin') || s === 'in') pk.dir = 'in';
      else if (s.includes('checkout') || s === 'out') pk.dir = 'out';
      else pk.dir = expectIn ? 'in' : 'out';
      expectIn = pk.dir === 'out';
    }
    let total = 0, openIn = null;
    for (const pk of p.punches) {
      if (pk.dir === 'in') openIn = pk.time;
      else if (openIn) { total += pk.time - openIn; openIn = null; }
    }
    const onSite = openIn !== null;
    if (onSite && viewingToday) total += Date.now() - openIn;
    const ins = p.punches.filter((x) => x.dir === 'in');
    const outs = p.punches.filter((x) => x.dir === 'out');
    p.firstIn = ins.length ? ins[0].time : null;
    p.lastOut = outs.length ? outs[outs.length - 1].time : null;
    p.onSite = onSite;
    p.totalMs = total;
    people.push(p);
  }
  people.sort((a, b) => (b.onSite - a.onSite) || ((a.firstIn || 0) - (b.firstIn || 0)));
  return people;
}

// Compare a day's summary against schedules to flag late / early / absent.
function evaluateDay(branchId, people, tzOffset = '+00:00') {
  const alerts = [];
  for (const p of people) {
    const sched = store.scheduleFor(branchId, p.employeeNo);
    const startMin = hhmmToMinutes(sched.start);
    const endMin = hhmmToMinutes(sched.end);
    const grace = Number(sched.graceMinutes || 0);
    if (p.firstIn) {
      const inMin = minutesOf(p.firstIn, tzOffset);
      p.lateBy = Math.max(0, inMin - (startMin + grace));
      p.late = p.lateBy > 0;
      if (p.late) alerts.push({ type: 'late', employeeNo: p.employeeNo, name: p.name, minutes: p.lateBy, at: p.firstIn });
    }
    if (p.lastOut && !p.onSite) {
      const outMin = minutesOf(p.lastOut, tzOffset);
      p.earlyBy = Math.max(0, endMin - outMin);
      p.leftEarly = p.earlyBy > 0;
      if (p.leftEarly) alerts.push({ type: 'earlyLeave', employeeNo: p.employeeNo, name: p.name, minutes: p.earlyBy, at: p.lastOut });
    }
    p.schedule = sched;
  }
  return { people, alerts };
}

// Roll several days of summaries into per-employee monthly metrics.
function monthlyMetrics(branchId, days, tzOffset = '+00:00') {
  // days: [{ date, people: [summary...] }]
  const byEmp = new Map();
  for (const day of days) {
    for (const p of day.people) {
      const sched = store.scheduleFor(branchId, p.employeeNo);
      if (!byEmp.has(p.key)) byEmp.set(p.key, {
        employeeNo: p.employeeNo, name: p.name, id: p.id,
        daysPresent: 0, lateCount: 0, earlyLeaveCount: 0,
        inMinutesSum: 0, inSamples: 0, outMinutesSum: 0, outSamples: 0,
        totalMs: 0, schedule: sched,
      });
      const rec = byEmp.get(p.key);
      if (p.firstIn || p.lastOut) rec.daysPresent++;
      if (p.firstIn) { rec.inMinutesSum += minutesOf(p.firstIn, tzOffset); rec.inSamples++; }
      if (p.lastOut) { rec.outMinutesSum += minutesOf(p.lastOut, tzOffset); rec.outSamples++; }
      if (p.late) rec.lateCount++;
      if (p.leftEarly) rec.earlyLeaveCount++;
      rec.totalMs += p.totalMs || 0;
    }
  }
  const fmt = (min) => {
    if (min == null) return null;
    const r = Math.round(min); const h = Math.floor(r / 60), m = r % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return [...byEmp.values()].map((r) => ({
    employeeNo: r.employeeNo, name: r.name, id: r.id,
    daysPresent: r.daysPresent,
    avgIn: r.inSamples ? fmt(r.inMinutesSum / r.inSamples) : null,
    avgOut: r.outSamples ? fmt(r.outMinutesSum / r.outSamples) : null,
    avgHours: r.daysPresent ? +(r.totalMs / r.daysPresent / 3600000).toFixed(1) : 0,
    lateCount: r.lateCount, earlyLeaveCount: r.earlyLeaveCount,
    schedule: r.schedule,
  })).sort((a, b) => b.lateCount - a.lateCount || a.name.localeCompare(b.name));
}

// Branch-level monthly metrics: opening/closing time and hours the site was open.
// open = earliest badge-in of the day; close = latest badge-out (or now, if still open).
function warehouseMonthly(days, tzOffset = '+00:00') {
  const fmt = (min) => { let h = Math.floor(min / 60), m = Math.round(min - h * 60); if (m === 60) { h++; m = 0; } return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  let daysOpened = 0, openSum = 0, closeSum = 0, closeSamples = 0, totalMs = 0;
  for (const day of days) {
    const ins = day.people.map((p) => p.firstIn).filter(Boolean);
    if (!ins.length) continue; // site never opened that day
    const outs = day.people.map((p) => p.lastOut).filter(Boolean);
    const earliest = new Date(Math.min(...ins.map((d) => d.getTime())));
    const stillOpen = day.isToday && day.people.some((p) => p.onSite);
    daysOpened++;
    openSum += minutesOf(earliest, tzOffset);
    if (stillOpen) {
      totalMs += Math.max(0, Date.now() - earliest.getTime()); // open through to now (today only)
    } else if (outs.length) {
      const latest = new Date(Math.max(...outs.map((d) => d.getTime())));
      closeSum += minutesOf(latest, tzOffset); closeSamples++;
      totalMs += Math.max(0, latest.getTime() - earliest.getTime());
    }
    // else: a past day with badge-ins but no badge-outs at all (missing punches) — count it as
    // opened, but leave its close and duration out rather than guess.
  }
  return {
    daysOpened,
    avgOpen: daysOpened ? fmt(openSum / daysOpened) : null,
    avgClose: closeSamples ? fmt(closeSum / closeSamples) : null,
    avgHoursPerDay: daysOpened ? +(totalMs / daysOpened / 3600000).toFixed(1) : 0,
    totalHours: +(totalMs / 3600000).toFixed(1),
  };
}

module.exports = { summariseDay, evaluateDay, monthlyMetrics, warehouseMonthly, parseTime };
