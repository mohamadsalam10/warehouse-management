// Thin API for the WhatsApp chatbot (n8n AI Agent). Secured by a shared secret (x-bot-secret),
// NOT the staff JWT. The app stays the single source of truth. Employees are matched by the
// last 9 digits of their phone. Approvals stay manager-in-the-loop unless noted "direct".
const express = require("express");
const { pool, query } = require("../db");
const { evalFormula } = require("../formula");
const { KIT_ITEMS } = require("../config");
const { notifyProcurement, logDispatch } = require("../notify");
const { defaultLeaveDays, leaveNoticeDays, maxMoversOnLeave } = require("../settings");

const router = express.Router();
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const isoMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmt = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(Number(n || 0));

router.use(express.json({ limit: "12mb" }));
router.use((req, res, next) => {
  const secret = process.env.BOT_SECRET;
  if (!secret) return res.status(503).json({ error: "Bot API is not configured (set BOT_SECRET)" });
  if ((req.get("x-bot-secret") || "") !== secret) return res.status(401).json({ error: "Unauthorized" });
  next();
});

async function findEmployeeByPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const r = await query(
    `SELECT * FROM candidates WHERE kind='employee'
       AND right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 9) = right($1, 9)
     ORDER BY id LIMIT 1`, [digits]);
  return r.rows[0] || null;
}
// resolve the employee or send a 404; returns null after responding
async function must(req, res) {
  const emp = await findEmployeeByPhone(req.query.phone || (req.body && req.body.phone));
  if (!emp) { res.status(404).json({ error: "No employee found for that phone number" }); return null; }
  return emp;
}

async function leaveSummary(empId) {
  const entitlement = await defaultLeaveDays();
  const { currentContract, contractCutoff } = require("../contracts");
  const contract = await currentContract(empId);
  const cutoff = await contractCutoff(empId, contract);
  const bonus = Number((await query("SELECT COALESCE(SUM(days),0) AS days FROM leave_compensations WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2)", [empId, cutoff])).rows[0].days);
  const leaves = (await query("SELECT * FROM employee_leaves WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2) ORDER BY start_date DESC", [empId, cutoff])).rows;
  const isVacation = (l) => l.type !== "Sick leave" && l.type !== "Unpaid leave" && l.deductible !== false;
  const taken = leaves.filter((l) => l.status === "Taken" && isVacation(l)).reduce((s, l) => s + l.days, 0);
  const planned = leaves.filter((l) => l.status === "Planned").reduce((s, l) => s + l.days, 0);
  return { entitlement, taken, planned, bonus, remaining: entitlement + bonus - taken - planned, leaves };
}

function compAmount(c, input, base) {
  if (c.input_kind === "formula") return evalFormula(c.formula || "0", { x: Number(input) || 0, base });
  return Number(input) || 0;
}
function resolveMonth(input) {
  const now = new Date();
  const s = String(input || "").trim().toLowerCase();
  if (!s || s === "this month" || s === "current") return isoMonth(now);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (s === "last month" || s === "previous") return isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const mi = names.findIndex((n) => n.startsWith(s) || s.startsWith(n.slice(0, 3)));
  if (mi >= 0) { let y = now.getFullYear(); if (mi > now.getMonth()) y -= 1; return `${y}-${String(mi + 1).padStart(2, "0")}`; }
  return isoMonth(now);
}
const b64 = (s) => { try { return s ? Buffer.from(String(s).split(",").pop(), "base64") : null; } catch { return null; } };

// ============================ READS ============================

// GET /api/bot/me?phone=
router.get("/me", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  res.json({ name: emp.name, position: emp.job_role, warehouse: emp.warehouse, city: emp.city, country: emp.country, startDate: d10(emp.start_date), phase: emp.phase, stage: emp.stage, code: emp.code });
});

// GET /api/bot/leave?phone=
router.get("/leave", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const s = await leaveSummary(emp.id);
  const rec = (l) => ({ startDate: d10(l.start_date), endDate: d10(l.end_date), days: l.days, type: l.type });
  res.json({
    employee: { name: emp.name, position: emp.job_role },
    entitlementDays: s.entitlement, takenDays: s.taken, plannedDays: s.planned, remainingDays: s.remaining,
    taken: s.leaves.filter((l) => l.status === "Taken").map((l) => ({ ...rec(l), countedAgainstBalance: l.deductible !== false })),
    upcoming: s.leaves.filter((l) => l.status === "Planned").map(rec),
  });
});

// GET /api/bot/contract?phone=
router.get("/contract", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const p = (await query("SELECT contract_start, contract_expiry FROM employee_profiles WHERE employee_id=$1", [emp.id])).rows[0] || {};
  const start = p.contract_start || emp.start_date;
  const end = p.contract_expiry || null;
  let daysRemaining = null;
  if (end) daysRemaining = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
  res.json({ employee: emp.name, contractStart: d10(start), contractEnd: d10(end), daysRemaining, expired: daysRemaining != null && daysRemaining < 0 });
});

// GET /api/bot/salary?phone=&month=
router.get("/salary", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const month = resolveMonth(req.query.month);
  const comps = (await query("SELECT * FROM salary_components ORDER BY sort_order, name")).rows;
  const sheet = (await query("SELECT * FROM salary_sheets WHERE employee_id=$1 AND month=$2", [emp.id, month])).rows[0];
  const base = emp.salary != null ? Number(emp.salary) : 0;
  const inputs = (sheet && sheet.bonuses) || {};
  let additions = [], deductions = [], net = base;
  for (const c of comps) {
    const amt = compAmount(c, inputs[c.name], base);
    if (!amt) continue;
    if (c.kind === "deduction") { deductions.push({ name: c.name, amount: amt }); net -= amt; }
    else { additions.push({ name: c.name, amount: amt }); net += amt; }
  }
  res.json({
    employee: emp.name, month,
    recorded: !!sheet, status: sheet ? sheet.status : "not set",
    baseAED: base,
    additions, deductions, netAED: net,
    summary: `Base AED ${fmt(base)}; additions ${additions.length ? additions.map((a) => `${a.name} AED ${fmt(a.amount)}`).join(", ") : "none"}; deductions ${deductions.length ? deductions.map((a) => `${a.name} AED ${fmt(a.amount)}`).join(", ") : "none"}; net AED ${fmt(net)}.`,
  });
});

// GET /api/bot/requests?phone=
router.get("/requests", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const rows = (await query("SELECT * FROM employee_requests WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 20", [emp.id])).rows;
  res.json({ employee: emp.name, requests: rows.map((r) => ({ id: r.id, type: r.type, status: r.status, days: r.days, item: r.item, size: r.size, amountAED: r.amount != null ? Number(r.amount) : null, startDate: d10(r.start_date), endDate: d10(r.end_date), note: r.note, decision: r.decision_note, createdAt: d10(r.created_at) })) });
});

// GET /api/bot/documents?phone=
router.get("/documents", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const rows = (await query("SELECT label, filename, expiry_date FROM employee_documents WHERE employee_id=$1 ORDER BY expiry_date NULLS LAST", [emp.id])).rows;
  const today = Date.now();
  res.json({ employee: emp.name, documents: rows.map((r) => ({ label: r.label, filename: r.filename, expiryDate: d10(r.expiry_date), daysToExpiry: r.expiry_date ? Math.ceil((new Date(r.expiry_date).getTime() - today) / 86400000) : null })) });
});

// GET /api/bot/uniform?phone=
router.get("/uniform", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const ord = (await query("SELECT id, status FROM procurement_orders WHERE employee_id=$1 ORDER BY id DESC LIMIT 1", [emp.id])).rows[0];
  let items = [];
  if (ord) items = (await query("SELECT item, size, quantity FROM procurement_order_items WHERE order_id=$1", [ord.id])).rows;
  res.json({ employee: emp.name, sizes: { tshirt: emp.tshirt_size || null, pants: emp.pants_size || null, shoe: emp.shoe_size || null }, order: ord ? { status: ord.status, items } : null });
});

// ============================ WRITES ============================

async function teamOf(emp) {
  const r = await query("SELECT team FROM positions WHERE name=$1 LIMIT 1", [emp.job_role]);
  return (r.rows[0] && r.rows[0].team) || "Warehouse";
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// The three leave checks. Returns { allowed, code, reason, remainingDays, earliestStart, conflict }.
async function leaveEligibility(emp, startDate, days) {
  const notice = await leaveNoticeDays();
  const entitlement = await defaultLeaveDays();
  const s = await leaveSummary(emp.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(startDate); start.setHours(0, 0, 0, 0);
  const end = addDays(start, Math.max(0, days - 1));
  const daysAhead = Math.round((start.getTime() - today.getTime()) / 86400000);
  const earliestStart = d10(addDays(today, notice));
  // Accrual from the current contract start. entitlement is a 2-year figure: accrued = monthsWorked * entitlement/24.
  let available = Math.max(0, entitlement - s.taken - s.planned + (s.bonus || 0));
  {
    const { currentContract } = require("../contracts");
    const contract = await currentContract(emp.id);
    const startWork = new Date(contract.start_date);
    const monthsWorked = Math.max(0, Math.floor((today.getTime() - startWork.getTime()) / (30.4375 * 86400000)));
    const accrued = Math.min(entitlement, Math.floor((monthsWorked * entitlement) / 24));
    available = Math.max(0, accrued - s.taken - s.planned + (s.bonus || 0));
  }
  if (Number.isNaN(start.getTime())) return { allowed: false, code: "DATE", reason: "I couldn't read the date.", remainingDays: available, earliestStart };
  if (daysAhead < notice) return { allowed: false, code: "NOTICE", reason: `Leave must be requested at least ${notice} days in advance.`, remainingDays: available, earliestStart };
  if (days > available) return { allowed: false, code: "BALANCE", reason: `Based on time worked so far you've accrued ${available} day(s) of leave.`, remainingDays: available, earliestStart };
  // coverage: approved leave (recorded in employee_leaves) overlapping the requested range, same team
  const eStr = d10(end), sStr = d10(start);
  const team = await teamOf(emp);
  if (team === "Movers") {
    const limit = await maxMoversOnLeave();
    const cnt = Number((await query(
      `SELECT COUNT(DISTINCT c.id) n FROM candidates c JOIN employee_leaves l ON l.employee_id=c.id
       JOIN positions p ON p.name=c.job_role
       WHERE c.id<>$1 AND p.team='Movers' AND l.start_date<=$2 AND l.end_date>=$3`,
      [emp.id, eStr, sStr])).rows[0].n);
    if (cnt >= limit) return { allowed: false, code: "COVERAGE", reason: `The movers team already has ${cnt} on leave for those dates.`, remainingDays: available, earliestStart, conflict: { type: "movers", count: cnt, limit } };
  } else if (emp.warehouse) {
    const other = (await query(
      `SELECT c.name FROM candidates c JOIN employee_leaves l ON l.employee_id=c.id
       WHERE c.id<>$1 AND c.warehouse=$2 AND l.start_date<=$3 AND l.end_date>=$4 LIMIT 1`,
      [emp.id, emp.warehouse, eStr, sStr])).rows[0];
    if (other) return { allowed: false, code: "COVERAGE", reason: `A teammate at ${emp.warehouse} is already on leave for those dates.`, remainingDays: available, earliestStart, conflict: { type: "warehouse", who: other.name } };
  }
  return { allowed: true, code: "OK", reason: null, remainingDays: available, earliestStart };
}

// GET /api/bot/leave-eligibility?phone=&startDate=&days=  (pure check, records nothing)
router.get("/leave-eligibility", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const days = Math.max(1, parseInt(req.query.days, 10) || 1);
  if (!req.query.startDate) return res.status(400).json({ error: "startDate is required" });
  res.json(await leaveEligibility(emp, req.query.startDate, days));
});

// POST /api/bot/leave-request  { phone, type, startDate, endDate, days?, note?, hasReport?, reportBase64? }
router.post("/leave-request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const type = req.body.type === "Sick leave" ? "Sick leave" : "Vacation";
  const { startDate, endDate, note } = req.body || {};
  let days = Number(req.body.days);
  if ((!days || Number.isNaN(days)) && startDate && endDate) {
    const a = new Date(startDate), b = new Date(endDate);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) days = Math.floor((b - a) / 86400000) + 1;
  }
  if (!days || days < 1) return res.status(400).json({ error: "Provide 'days', or a valid startDate and endDate" });

  if (type === "Sick leave") {
    const file = b64(req.body.reportBase64);
    const r = await query(
      `INSERT INTO employee_requests (employee_id, type, start_date, end_date, days, note, status, report_filename, report_mime, report_bytes)
       VALUES ($1,'Sick leave',$2,$3,$4,$5,'Pending',$6,$7,$8) RETURNING id`,
      [emp.id, startDate || null, endDate || null, days, note || null, file ? "medical-report" : null, file ? "application/octet-stream" : null, file || null]);
    return res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Sick leave", days, hasReport: !!file, status: "Pending", message: `Sick leave for ${days} day(s) submitted${file ? " with your report" : ""} for HR to review.` });
  }

  // Vacation: run the eligibility checks
  const e = await leaveEligibility(emp, startDate, days);
  if (!e.allowed) {
    let message;
    if (e.code === "NOTICE") message = `Leave needs a bit more notice — the earliest I can start it is ${e.earliestStart}. Shall I use that?`;
    else if (e.code === "BALANCE") message = `Based on what you've built up so far, you can take up to ${e.remainingDays} day(s). Want to adjust?`;
    else if (e.code === "COVERAGE") message = `Someone from your team is already off on those dates, so I can't add more time off then — could you pick different dates?`;
    else message = "I couldn't read those dates — could you send them again?";
    // record the blocked request as Rejected so HR has the history
    await query(
      `INSERT INTO employee_requests (employee_id, type, start_date, end_date, days, note, status, decided_by, decided_at, decision_note)
       VALUES ($1,'Vacation',$2,$3,$4,$5,'Rejected','Auto', now(), $6)`,
      [emp.id, startDate || null, endDate || null, days, note || null, `Auto-declined (${e.code}): ${e.reason}`]);
    return res.status(200).json({ ok: false, allowed: false, code: e.code, reason: e.reason, remainingDays: e.remainingDays, earliestStart: e.earliestStart, conflict: e.conflict || null, status: "Rejected", message });
  }
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, start_date, end_date, days, note, status)
     VALUES ($1,'Vacation',$2,$3,$4,$5,'Pending') RETURNING id`,
    [emp.id, startDate || null, endDate || null, days, note || null]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Vacation", days, remainingBeforeApproval: e.remainingDays, status: "Pending", message: `Your leave from ${startDate} to ${endDate} is waiting for approval.` });
});

// GET /api/bot/ticket?phone=  -> current contract's flight-ticket status (available vs already taken)
router.get("/ticket", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const { currentContract } = require("../contracts");
  const contract = await currentContract(emp.id);
  const taken = contract.ticket_status === "taken";
  res.json({
    employee: emp.name,
    available: !taken,          // true = not yet used this contract, can still be taken
    taken,                      // true = already taken for this contract
    status: contract.ticket_status || "available",
    contractStart: d10(contract.start_date),
    contractEnd: d10(contract.end_date),
  });
});

// GET /api/bot/insurance?phone=
router.get("/insurance", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const exp = emp.insurance_expiry ? new Date(emp.insurance_expiry) : null;
  const days = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;
  res.json({ employee: emp.name, valid: exp ? days >= 0 : false, expiryDate: d10(emp.insurance_expiry), daysToExpiry: days, onFile: !!exp });
});

// POST /api/bot/facility-request  { phone, category, item, note?, attachmentBase64? }  -> auto procurement order
router.post("/facility-request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const category = ["supply", "maintenance", "equipment"].includes(req.body.category) ? req.body.category : "supply";
  const item = (req.body.item || req.body.note || "").trim();
  if (!item) return res.status(400).json({ error: "Describe what's needed or what's broken" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ord = await client.query("INSERT INTO procurement_orders (employee_id, status, auto, created_by, category) VALUES ($1,'pending',true,'Chatbot','facility') RETURNING id", [emp.id]);
    await client.query("INSERT INTO procurement_order_items (order_id, item, quantity) VALUES ($1,$2,1)", [ord.rows[0].id, `[${category}] ${item}`]);
    const file = b64(req.body.attachmentBase64);
    const rq = await client.query(
      `INSERT INTO employee_requests (employee_id, type, note, status, report_filename, report_mime, report_bytes)
       VALUES ($1,'Facility',$2,'Closed',$3,$4,$5) RETURNING id`,
      [emp.id, `[${category}] ${item}`, file ? "photo" : null, file ? "application/octet-stream" : null, file || null]);
    await client.query("COMMIT");
    try { await logDispatch(emp.id, "Procurement order notice", notifyProcurement({ name: emp.name, job_role: `facility: ${item}` })); } catch (e) {}
    res.status(201).json({ ok: true, requestId: rq.rows[0].id, workOrderId: ord.rows[0].id, category, status: "Closed", message: "Raised with procurement/maintenance." });
  } catch (e) { await client.query("ROLLBACK"); console.error("facility error", e.message); res.status(500).json({ error: "Could not raise the request" }); } finally { client.release(); }
});

// (legacy) POST /api/bot/sick-leave { phone, startDate, endDate, days?, note?, reportBase64? }
router.post("/sick-leave", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const { startDate, endDate, note } = req.body || {};
  let days = Number(req.body.days);
  if ((!days || Number.isNaN(days)) && startDate && endDate) {
    const a = new Date(startDate), b = new Date(endDate);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) days = Math.floor((b - a) / 86400000) + 1;
  }
  if (!days || days < 1) return res.status(400).json({ error: "Provide 'days', or a valid startDate and endDate" });
  const file = b64(req.body.reportBase64);
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, start_date, end_date, days, note, status, report_filename, report_mime, report_bytes)
     VALUES ($1,'Sick leave',$2,$3,$4,$5,'Pending',$6,$7,$8) RETURNING id`,
    [emp.id, startDate || null, endDate || null, days, note || null, file ? "medical-report" : null, file ? "application/octet-stream" : null, file || null]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Sick leave", days, hasReport: !!file, status: "Pending", message: `Sick leave for ${days} day(s) submitted${file ? " with your report" : ""} for HR to review.` });
});

// POST /api/bot/uniform-request  { phone, item, size?, quantity?, note? }  -> Pending
router.post("/uniform-request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const { item, size, quantity, note } = req.body || {};
  if (!item) return res.status(400).json({ error: "item is required" });
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, item, size, quantity, note, status)
     VALUES ($1,'Uniform',$2,$3,$4,$5,'Pending') RETURNING id`,
    [emp.id, item, size || null, quantity ? parseInt(quantity, 10) : 1, note || null]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Uniform", item, size: size || null, status: "Pending", message: `Uniform request for ${item}${size ? ` (size ${size})` : ""} submitted and is pending approval.` });
});

// POST /api/bot/update-size  { phone, item, size }  -> DIRECT (profile + open order)
router.post("/update-size", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const { item, size } = req.body || {};
  if (!item || !size) return res.status(400).json({ error: "item and size are required" });
  const n = String(item).toLowerCase();
  let col = null, kind = null;
  if (n.includes("shirt") || n.includes("tee") || n.includes("polo") || n.includes("top")) { col = "tshirt_size"; kind = "shirt"; }
  else if (n.includes("pant") || n.includes("trouser") || n.includes("bottom")) { col = "pants_size"; kind = "pants"; }
  else if (n.includes("shoe") || n.includes("boot") || n.includes("foot")) { col = "shoe_size"; kind = "shoe"; }
  if (!col) return res.status(400).json({ error: "Unknown uniform item; say shirt, pants or shoe" });
  await query(`UPDATE candidates SET ${col}=$1 WHERE id=$2`, [size, emp.id]);
  const ord = (await query("SELECT id FROM procurement_orders WHERE employee_id=$1 AND status<>'received' ORDER BY id DESC LIMIT 1", [emp.id])).rows[0];
  let updatedOrder = false;
  if (ord) {
    const its = (await query("SELECT id, item FROM procurement_order_items WHERE order_id=$1", [ord.id])).rows;
    for (const it of its) {
      const m = (it.item || "").toLowerCase();
      const match = (kind === "shirt" && (m.includes("shirt") || m.includes("tee") || m.includes("polo"))) || (kind === "pants" && (m.includes("pant") || m.includes("trouser") || m.includes("bottom"))) || (kind === "shoe" && (m.includes("shoe") || m.includes("boot") || m.includes("foot")));
      if (match) { await query("UPDATE procurement_order_items SET size=$1 WHERE id=$2", [size, it.id]); updatedOrder = true; }
    }
  }
  res.json({ ok: true, item: kind, size, updatedProfile: true, updatedOpenOrder: updatedOrder, message: `Your ${kind} size is now ${size}.` });
});

// POST /api/bot/training-request  { phone, level?, note? }  -> creates a training work order to be assigned
router.post("/training-request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const levels = ["Basics", "Safety", "Application"];
  const level = levels.includes(req.body.level) ? req.body.level : "Application";
  await query(
    `INSERT INTO training_assignments (candidate_id, stage, assigned_by, assigned_at, completed_at)
     VALUES ($1,$2,'Chatbot request', now(), NULL)
     ON CONFLICT (candidate_id, stage) DO UPDATE SET assigned_by='Chatbot request', assigned_at=now(), completed_at=NULL`,
    [emp.id, level]);
  res.status(201).json({ ok: true, type: "Training", level, status: "Requested", message: `Your ${level} training request has been logged; a trainer will be assigned.` });
});

// POST /api/bot/refer  { referrerPhone (or phone), name, position, phone?, referredPhone?, cvBase64?, cvName? }
router.post("/refer", async (req, res) => {
  const referrer = await findEmployeeByPhone(req.body.referrerPhone || req.body.phone);
  const { name, position } = req.body || {};
  const referredPhone = req.body.referredPhone || null;
  if (!name || !position) return res.status(400).json({ error: "name and position of the referred person are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const maxId = (await client.query("SELECT COALESCE(MAX(id),1041) AS m FROM candidates")).rows[0].m;
    const code = `EMP-${maxId + 1}`;
    const cv = b64(req.body.cvBase64);
    const ins = await client.query(
      `INSERT INTO candidates (code, name, job_role, country, city, phone, phase, stage, kind, through, referrer_phone, cv_filename, cv_mime, cv_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,'Recruitment','Pending interview','candidate',$7,$8,$9,$10,$11) RETURNING id`,
      [code, String(name).trim(), position, referrer ? referrer.country : "UAE", referrer ? referrer.city : "Dubai", referredPhone,
       referrer ? `Referral: ${referrer.name}` : "Referral", referrer ? referrer.phone : null, cv ? (req.body.cvName || "cv.pdf") : null, cv ? "application/pdf" : null, cv || null]);
    const id = ins.rows[0].id;
    for (const it of KIT_ITEMS) await client.query("INSERT INTO kit_orders (candidate_id, item, status) VALUES ($1,$2,'pending')", [id, it]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'created',$2,$3)", [id, `Referred by ${referrer ? referrer.name : "an employee"}`, "Chatbot"]);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, applicantId: id, name, position, through: referrer ? referrer.name : "Referral", cvAttached: !!cv, message: `Thanks. ${name} has been added as an applicant for ${position}${referrer ? `, referred by ${referrer.name}` : ""}.` });
  } catch (e) { await client.query("ROLLBACK"); console.error("refer error", e.message); res.status(500).json({ error: "Could not add the referral" }); } finally { client.release(); }
});

// POST /api/bot/decline-request  { phone, type, note, reason? }  -> records an already-Rejected request
// (e.g. salary raise, loan/advance) so HR has the history without having to action it.
router.post("/decline-request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const type = (req.body.type || "Other").toString().trim().slice(0, 40) || "Other";
  const note = req.body.note || null;
  const reason = (req.body.reason || "Not approved").toString().slice(0, 200);
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, note, status, decided_by, decided_at, decision_note)
     VALUES ($1,$2,$3,'Rejected','Auto', now(), $4) RETURNING id`,
    [emp.id, type, note, reason]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type, status: "Rejected", message: "Recorded." });
});

// POST /api/bot/request  { phone, note, attachmentBase64?, attachmentName? }  -> "Other", Pending
router.post("/request", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const { note } = req.body || {};
  if (!note) return res.status(400).json({ error: "note is required" });
  const file = b64(req.body.attachmentBase64);
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, note, status, report_filename, report_mime, report_bytes)
     VALUES ($1,'Other',$2,'Pending',$3,$4,$5) RETURNING id`,
    [emp.id, note, file ? (req.body.attachmentName || "attachment") : null, file ? (req.body.attachmentMime || "application/octet-stream") : null, file || null]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Other", status: "Pending", attachment: !!file, message: "Your request has been submitted to HR." });
});

// POST /api/bot/reimbursement  { phone, amount, reason, receiptBase64?, receiptName? }  -> Pending; on approval creates a pending payment
router.post("/reimbursement", async (req, res) => {
  const emp = await must(req, res); if (!emp) return;
  const amount = Number(req.body.amount);
  const reason = req.body.reason || req.body.note;
  if (!amount || amount <= 0) return res.status(400).json({ error: "A positive amount is required" });
  if (!reason) return res.status(400).json({ error: "A reason is required" });
  const file = b64(req.body.receiptBase64);
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, amount, note, status, report_filename, report_mime, report_bytes)
     VALUES ($1,'Reimbursement',$2,$3,'Pending',$4,$5,$6) RETURNING id`,
    [emp.id, amount, reason, file ? (req.body.receiptName || "receipt") : null, file ? (req.body.receiptMime || "application/octet-stream") : null, file || null]);
  res.status(201).json({ ok: true, requestId: r.rows[0].id, type: "Reimbursement", amountAED: amount, status: "Pending", receipt: !!file, message: `Your reimbursement request for AED ${fmt(amount)} has been submitted. Once approved by HR it becomes a payment.` });
});

module.exports = router;
