const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const { defaultLeaveDays } = require("../settings");
const { signEmployeeToken, requireEmployee } = require("../auth");
const { evalFormula } = require("../formula");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const num = (v) => (v == null ? 0 : parseFloat(v));

function me(c) {
  return { id: c.id, code: c.code, name: c.name, position: c.job_role, country: c.country, city: c.city, warehouse: c.warehouse, phase: c.phase, stage: c.stage, startDate: d10(c.start_date), salary: c.salary != null ? num(c.salary) : null };
}

// POST /api/portal/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  const r = await query("SELECT * FROM candidates WHERE lower(portal_email) = lower($1) AND kind='employee'", [email]);
  const emp = r.rows[0];
  if (!emp || !emp.portal_password_hash) return res.status(401).json({ error: "Incorrect email or password" });
  const ok = await bcrypt.compare(password, emp.portal_password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect email or password" });
  res.json({ token: signEmployeeToken(emp), employee: me(emp) });
});

router.use(requireEmployee);
const self = (req) => req.employee.id;

// GET /api/portal/meta  (options the portal needs, e.g. uniform items for requests)
router.get("/meta", async (req, res) => {
  const items = (await query("SELECT name FROM uniform_items ORDER BY name")).rows.map((r) => r.name);
  res.json({ uniformItems: items });
});

// GET /api/portal/me
router.get("/me", async (req, res) => {
  const c = (await query("SELECT * FROM candidates WHERE id=$1", [self(req)])).rows[0];
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json(me(c));
});

// GET /api/portal/salary?month=YYYY-MM  (base from profile; components with bonus/deduction + formulas)
router.get("/salary", async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const comps = (await query("SELECT name, kind, input_kind, formula FROM salary_components ORDER BY sort_order, name")).rows;
  const emp = (await query("SELECT salary FROM candidates WHERE id=$1", [self(req)])).rows[0];
  const base = num(emp && emp.salary);
  const sheet = (await query("SELECT * FROM salary_sheets WHERE employee_id=$1 AND month=$2", [self(req), month])).rows[0];
  const inputs = (sheet && sheet.bonuses) || {};
  const status = sheet ? sheet.status : "not set";
  let total = base; const lines = [];
  for (const c of comps) {
    const amt = c.input_kind === "formula" ? evalFormula(c.formula, { x: num(inputs[c.name]), base }) : num(inputs[c.name]);
    total += c.kind === "deduction" ? -amt : amt;
    if (amt) lines.push({ name: c.name, kind: c.kind, amount: amt });
  }
  res.json({ month, base, components: lines, total, status });
});

// GET /api/portal/leave
router.get("/leave", async (req, res) => {
  const { currentContract, contractCutoff } = require("../contracts");
  const contract = await currentContract(self(req));
  const cutoff = await contractCutoff(self(req), contract);
  const entitlement = await defaultLeaveDays();
  const leaves = (await query("SELECT * FROM employee_leaves WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2) ORDER BY start_date DESC NULLS LAST, id DESC", [self(req), cutoff])).rows
    .map((l) => ({ id: l.id, startDate: d10(l.start_date), endDate: d10(l.end_date), days: l.days, type: l.type, status: l.status, deductible: l.deductible !== false }));
  const taken = leaves.filter((l) => l.status === "Taken" && l.deductible !== false).reduce((s, l) => s + Number(l.days), 0);
  const planned = leaves.filter((l) => l.status === "Planned").reduce((s, l) => s + Number(l.days), 0);
  const bonus = Number((await query("SELECT COALESCE(SUM(days),0) AS days FROM leave_compensations WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2)", [self(req), cutoff])).rows[0].days);
  res.json({ entitlement, bonus, taken, planned, remaining: entitlement + bonus - taken - planned, contractExpiry: d10(contract.end_date), leaves });
});

// GET /api/portal/documents  (+ download)
router.get("/documents", async (req, res) => {
  const rows = (await query("SELECT id, label, filename, expiry_date, uploaded_by FROM employee_documents WHERE employee_id=$1 ORDER BY uploaded_at DESC", [self(req)])).rows;
  res.json(rows.map((d) => ({ id: d.id, label: d.label, filename: d.filename, expiry: d10(d.expiry_date), mine: d.uploaded_by === "Employee" })));
});
router.get("/documents/:id", async (req, res) => {
  const d = (await query("SELECT filename, mime, bytes FROM employee_documents WHERE id=$1 AND employee_id=$2", [req.params.id, self(req)])).rows[0];
  if (!d || !d.bytes) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", d.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${d.filename || "document"}"`);
  res.send(d.bytes);
});

// POST /api/portal/documents  (multipart: label, expiry?, file)  employee uploads their own document
router.post("/documents", upload.single("file"), async (req, res) => {
  const { label, expiry } = req.body || {};
  if (!label) return res.status(400).json({ error: "A document name is required" });
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload" });
  await query(
    "INSERT INTO employee_documents (employee_id, label, filename, mime, bytes, expiry_date, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [self(req), label, req.file.originalname, req.file.mimetype, req.file.buffer, expiry || null, "Employee"]
  );
  res.status(201).json({ ok: true });
});

// DELETE /api/portal/documents/:id  (only documents the employee uploaded themselves)
router.delete("/documents/:id", async (req, res) => {
  const r = await query("DELETE FROM employee_documents WHERE id=$1 AND employee_id=$2 AND uploaded_by='Employee' RETURNING id", [req.params.id, self(req)]);
  if (!r.rows[0]) return res.status(400).json({ error: "You can only remove documents you uploaded" });
  res.json({ deleted: true });
});

// GET /api/portal/uniform
router.get("/uniform", async (req, res) => {
  const orders = (await query("SELECT * FROM procurement_orders WHERE employee_id=$1 ORDER BY created_at DESC", [self(req)])).rows;
  const ids = orders.map((o) => o.id);
  let itemsBy = {};
  if (ids.length) (await query("SELECT * FROM procurement_order_items WHERE order_id = ANY($1) ORDER BY id", [ids])).rows.forEach((i) => (itemsBy[i.order_id] ||= []).push(i));
  res.json(orders.map((o) => ({ id: o.id, status: o.status, createdAt: d10(o.created_at), items: (itemsBy[o.id] || []).map((i) => ({ item: i.item, size: i.size, quantity: i.quantity })) })));
});

// GET /api/portal/requests
router.get("/requests", async (req, res) => {
  const rows = (await query("SELECT id, type, start_date, end_date, days, item, size, quantity, note, status, decision_note, decided_by, created_at, report_filename, report_approved FROM employee_requests WHERE employee_id=$1 ORDER BY created_at DESC", [self(req)])).rows;
  res.json(rows.map(reqView));
});

// POST /api/portal/requests  (JSON, or multipart with a `report` file for sick leave)
router.post("/requests", upload.single("report"), async (req, res) => {
  const { type, startDate, endDate, days, item, size, quantity, note } = req.body || {};
  const allowed = ["Vacation", "Sick leave", "Uniform", "Training", "Reimbursement", "Other"];
  if (!allowed.includes(type)) return res.status(400).json({ error: "Unknown request type" });
  if ((type === "Vacation" || type === "Sick leave") && !days) return res.status(400).json({ error: "Number of days is required" });
  if (type === "Uniform" && !item) return res.status(400).json({ error: "Item is required" });
  const amount = type === "Reimbursement" ? Number(req.body.amount) : null;
  if (type === "Reimbursement" && (!amount || amount <= 0)) return res.status(400).json({ error: "A positive amount is required" });
  if (type === "Reimbursement" && !note) return res.status(400).json({ error: "A reason is required" });
  // Attachment: medical report for sick leave, receipt for reimbursement, any file for Other.
  const file = ["Sick leave", "Reimbursement", "Other"].includes(type) && req.file ? req.file : null;
  // Extra training sessions are logged directly (no approval), like the chatbot.
  const direct = type === "Training";
  const r = await query(
    `INSERT INTO employee_requests (employee_id, type, start_date, end_date, days, item, size, quantity, amount, note, status, decided_by, decided_at, decision_note, report_filename, report_mime, report_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id, type, start_date, end_date, days, item, size, quantity, amount, note, status, decision_note, decided_by, created_at, report_filename, report_approved`,
    [self(req), type, startDate || null, endDate || null, days ? parseInt(days, 10) : null, item || null, size || null, quantity ? parseInt(quantity, 10) : null,
     amount, note || null, direct ? "Approved" : "Pending", direct ? "Self-service" : null, direct ? new Date() : null, direct ? `Extra ${note || "training"} session logged` : null,
     file ? file.originalname : null, file ? file.mimetype : null, file ? file.buffer : null]
  );
  res.status(201).json(reqView(r.rows[0]));
});

// GET /api/portal/requests/:id/report  (employee downloads their own submitted report)
router.get("/requests/:id/report", async (req, res) => {
  const r = (await query("SELECT report_filename, report_mime, report_bytes FROM employee_requests WHERE id=$1 AND employee_id=$2", [req.params.id, self(req)])).rows[0];
  if (!r || !r.report_bytes) return res.status(404).json({ error: "No report" });
  res.setHeader("Content-Type", r.report_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${r.report_filename || "medical-report"}"`);
  res.send(r.report_bytes);
});

function reqView(r) {
  return { id: r.id, type: r.type, startDate: d10(r.start_date), endDate: d10(r.end_date), days: r.days, item: r.item, size: r.size, quantity: r.quantity, amount: r.amount != null ? Number(r.amount) : null, note: r.note, status: r.status, decisionNote: r.decision_note, decidedBy: r.decided_by, createdAt: d10(r.created_at), hasReport: !!r.report_filename, reportApproved: r.report_approved };
}

module.exports = router;
module.exports.reqView = reqView;
