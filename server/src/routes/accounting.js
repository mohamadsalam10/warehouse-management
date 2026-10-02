const express = require("express");
const crypto = require("crypto");
const { query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin, canSee } = require("../config");
const { evalFormula } = require("../formula");
const { sendWhatsApp } = require("../respondio");
const { respondConfig, settlementTemplate } = require("../settings");
const { sendSalaryBreakdown, sendPayslipLink } = require("../notify");

const router = express.Router();
router.use(requireAuth);
const num = (v) => (v === null || v === undefined || v === "" ? 0 : parseFloat(v) || 0);
const cView = (c) => ({ name: c.name, kind: c.kind, inputKind: c.input_kind, formula: c.formula || "" });

function compAmount(c, rawInput, base) {
  if (c.input_kind === "formula") return evalFormula(c.formula, { x: num(rawInput), base });
  return num(rawInput);
}
function totals(base, inputs, comps) {
  const amounts = {}; let total = base;
  for (const c of comps) { const amt = compAmount(c, inputs[c.name], base); amounts[c.name] = amt; total += c.kind === "deduction" ? -amt : amt; }
  return { amounts, total };
}

async function loadComponents() { return (await query("SELECT * FROM salary_components ORDER BY sort_order, name")).rows; }

// ---- Salary component config (manager/admin) ----
router.get("/components", async (req, res) => { res.json((await loadComponents()).map((c) => ({ id: c.id, name: c.name, kind: c.kind, inputKind: c.input_kind, formula: c.formula || "" }))); });
router.post("/components", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const { name, kind, inputKind, formula } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (inputKind === "formula" && !formula) return res.status(400).json({ error: "A formula is required for formula components" });
  try {
    await query("INSERT INTO salary_components (name, kind, input_kind, formula) VALUES ($1,$2,$3,$4)",
      [name, kind === "deduction" ? "deduction" : "bonus", inputKind === "formula" ? "formula" : "amount", inputKind === "formula" ? formula : null]);
    res.status(201).json({ ok: true });
  } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "A component with that name already exists" }); throw e; }
});
router.patch("/components/:id", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const { kind, inputKind, formula } = req.body || {};
  await query("UPDATE salary_components SET kind=COALESCE($1,kind), input_kind=COALESCE($2,input_kind), formula=$3 WHERE id=$4",
    [kind || null, inputKind || null, inputKind === "formula" ? (formula || "") : null, req.params.id]);
  res.json({ ok: true });
});
router.delete("/components/:id", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  await query("DELETE FROM salary_components WHERE id=$1", [req.params.id]);
  res.json({ deleted: true });
});

// GET /api/accounting/salaries?month=YYYY-MM&country=&city=   base comes from the employee profile
router.get("/salaries", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month, country, city } = req.query;
  if (!month) return res.status(400).json({ error: "month is required" });
  const comps = await loadComponents();
  const clauses = ["kind = 'employee'"], params = [];
  if (country) { params.push(country); clauses.push(`country = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  const emps = (await query(`SELECT id, code, name, job_role, warehouse, salary FROM candidates WHERE ${clauses.join(" AND ")} ORDER BY name`, params)).rows;
  const ids = emps.map((e) => e.id);
  let current = {};
  if (ids.length) (await query("SELECT * FROM salary_sheets WHERE month = $1 AND employee_id = ANY($2)", [month, ids])).rows.forEach((r) => (current[r.employee_id] = r));
  const rows = emps.map((e) => {
    const base = num(e.salary);
    const sheet = current[e.id];
    const inputs = (sheet && sheet.bonuses) || {};
    const { amounts, total } = totals(base, inputs, comps);
    return { employeeId: e.id, code: e.code, name: e.name, position: e.job_role, warehouse: e.warehouse, base, inputs, amounts, total, status: sheet ? sheet.status : "draft", updatedBy: sheet ? sheet.updated_by : null };
  });
  res.json({ month, components: comps.map(cView), rows });
});

// helper: additions/deductions/net for one employee sheet
function breakdown(base, inputs, comps) {
  const { amounts, total } = totals(base, inputs, comps);
  let additions = 0, deductions = 0;
  for (const c of comps) { const amt = amounts[c.name] || 0; if (c.kind === "deduction") deductions += amt; else additions += amt; }
  return { amounts, additions, deductions, net: total };
}
const fmtAed = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(Number(n || 0));
// build a single-line, comma-separated itemized list for one kind (bonus/deduction)
function itemize(comps, amounts, kind) {
  const items = comps.filter((c) => (kind === "deduction" ? c.kind === "deduction" : c.kind !== "deduction") && Math.abs(amounts[c.name] || 0) > 0)
    .map((c) => `${c.name} AED ${fmtAed(amounts[c.name])}`);
  return items.length ? items.join(", ") : "none";
}

// Generate the payslip PDF, save it to the employee's documents, return a public link.
async function makePayslip(emp, month, base, comps, amounts, net, actor) {
  const { generatePayslip } = require("../payslip");
  const additions = comps.filter((c) => c.kind !== "deduction" && Math.abs(amounts[c.name] || 0) > 0).map((c) => ({ name: c.name, amount: amounts[c.name] }));
  const deductions = comps.filter((c) => c.kind === "deduction" && Math.abs(amounts[c.name] || 0) > 0).map((c) => ({ name: c.name, amount: amounts[c.name] }));
  const pdf = await generatePayslip({ name: emp.name, position: emp.job_role, month, base, additions, deductions, net });
  await query("DELETE FROM employee_documents WHERE employee_id=$1 AND label=$2", [emp.id, `Payslip ${month}`]);
  const token = require("crypto").randomBytes(20).toString("hex");
  await query("INSERT INTO employee_documents (employee_id, label, filename, mime, bytes, uploaded_by, share_token) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6)",
    [emp.id, `Payslip ${month}`, `payslip-${month}.pdf`, Buffer.from(pdf), actor || "System", token]);
  return token;
}

// POST /api/accounting/salaries/:employeeId/dispatch  { month }  -> generate payslip PDF, save to documents, WhatsApp the link
router.post("/salaries/:employeeId/dispatch", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month } = req.body || {};
  if (!month) return res.status(400).json({ error: "month is required" });
  const emp = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.employeeId])).rows[0];
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const comps = await loadComponents();
  const sheet = (await query("SELECT * FROM salary_sheets WHERE employee_id=$1 AND month=$2", [emp.id, month])).rows[0];
  const base = num(emp.salary);
  const b = breakdown(base, (sheet && sheet.bonuses) || {}, comps);
  const token = await makePayslip(emp, month, base, comps, b.amounts, b.net, req.user.name);
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const link = `${baseUrl}/payslip/${token}`;
  let d = { sent: false, error: "no phone" };
  if (emp.phone) d = await sendPayslipLink(emp, month, link);
  res.json({ ok: true, delivery: d, link, savedToProfile: true });
});

// POST /api/accounting/salaries/dispatch-all  { month, country?, city? }  -> WhatsApp every employee their summary
router.post("/salaries/dispatch-all", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month, country, city } = req.body || {};
  if (!month) return res.status(400).json({ error: "month is required" });
  const comps = await loadComponents();
  const clauses = ["kind = 'employee'"], params = [];
  if (country) { params.push(country); clauses.push(`country = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  const emps = (await query(`SELECT * FROM candidates WHERE ${clauses.join(" AND ")}`, params)).rows;
  const ids = emps.map((e) => e.id);
  let sheets = {};
  if (ids.length) (await query("SELECT * FROM salary_sheets WHERE month=$1 AND employee_id = ANY($2)", [month, ids])).rows.forEach((r) => (sheets[r.employee_id] = r));
  let sent = 0, skipped = 0;
  for (const e of emps) {
    if (!e.phone) { skipped++; continue; }
    const base = num(e.salary);
    const b = breakdown(base, (sheets[e.id] && sheets[e.id].bonuses) || {}, comps);
    const token = await makePayslip(e, month, base, comps, b.amounts, b.net, req.user.name);
    if (!e.phone) { skipped++; continue; }
    const link = `${(process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`)}/payslip/${token}`;
    const d = await sendPayslipLink(e, month, link);
    if (d.sent) sent++; else skipped++;
  }
  res.json({ ok: true, sent, skipped, total: emps.length });
});

// POST /api/accounting/salaries/:employeeId/cash  { month }  -> create a pending payment (cash settlement) for the net salary
router.post("/salaries/:employeeId/cash", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month } = req.body || {};
  if (!month) return res.status(400).json({ error: "month is required" });
  const emp = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.employeeId])).rows[0];
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const comps = await loadComponents();
  const sheet = (await query("SELECT * FROM salary_sheets WHERE employee_id=$1 AND month=$2", [emp.id, month])).rows[0];
  const base = num(emp.salary);
  const b = breakdown(base, (sheet && sheet.bonuses) || {}, comps);
  const existing = (await query("SELECT id FROM pending_payments WHERE person_id=$1 AND reason=$2 AND status<>'paid'", [emp.id, `Cash salary ${month}`])).rows[0];
  if (existing) return res.status(409).json({ error: "A cash settlement for this month is already pending" });
  const r = await query(
    `INSERT INTO pending_payments (person_id, name, position, country, city, days, daily_rate, amount, reason, status, created_by)
     VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,'pending',$8) RETURNING id`,
    [emp.id, emp.name, emp.job_role, emp.country, emp.city, b.net, `Cash salary ${month}`, req.user.name]
  );
  res.status(201).json({ ok: true, id: r.rows[0].id, amount: b.net });
});

// PUT /api/accounting/salaries/:employeeId  { month, inputs }   (manager fills bonuses/deductions; base is read-only from profile)
router.put("/salaries/:employeeId", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Only the manager can edit salary amounts" });
  const { month, inputs } = req.body || {};
  if (!month) return res.status(400).json({ error: "month is required" });
  const emp = (await query("SELECT salary FROM candidates WHERE id=$1", [req.params.employeeId])).rows[0];
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  await query(
    `INSERT INTO salary_sheets (employee_id, month, base, bonuses, status, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,'ready',$5, now())
     ON CONFLICT (employee_id, month) DO UPDATE SET base=$3, bonuses=$4, status=CASE WHEN salary_sheets.status='transferred' THEN 'transferred' ELSE 'ready' END, updated_by=$5, updated_at=now()`,
    [req.params.employeeId, month, num(emp.salary), JSON.stringify(inputs || {}), req.user.name]
  );
  res.json({ ok: true });
});

// POST /api/accounting/salaries/:employeeId/transfer  { month }
router.post("/salaries/:employeeId/transfer", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month } = req.body || {};
  const r = await query("UPDATE salary_sheets SET status='transferred', updated_by=$1, updated_at=now() WHERE employee_id=$2 AND month=$3 RETURNING *", [req.user.name, req.params.employeeId, month]);
  if (!r.rows[0]) return res.status(400).json({ error: "Set the salary before transferring" });
  res.json({ ok: true });
});

// POST /api/accounting/salaries/transfer-all  { month, country, city }
router.post("/salaries/transfer-all", async (req, res) => {
  if (!canSee(req.user.role, "salaries")) return res.status(403).json({ error: "No access" });
  const { month, country, city } = req.body || {};
  if (!month) return res.status(400).json({ error: "month is required" });
  const clauses = ["kind = 'employee'"], params = [];
  if (country) { params.push(country); clauses.push(`country = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  const emps = (await query(`SELECT id, salary FROM candidates WHERE ${clauses.join(" AND ")}`, params)).rows.filter((e) => e.salary != null);
  if (!emps.length) return res.json({ count: 0 });
  let count = 0;
  for (const e of emps) {
    // create the sheet if missing, then mark transferred (skips ones already transferred)
    const up = await query(
      `INSERT INTO salary_sheets (employee_id, month, base, bonuses, status, updated_by, updated_at)
       VALUES ($1,$2,$3,'{}'::jsonb,'transferred',$4,now())
       ON CONFLICT (employee_id, month) DO UPDATE SET status='transferred', updated_by=$4, updated_at=now()
       WHERE salary_sheets.status <> 'transferred' RETURNING employee_id`,
      [e.id, month, Number(e.salary), req.user.name]);
    if (up.rows.length) count++;
  }
  res.json({ count });
});

// GET /api/accounting/pending-payments?country=&city=
router.get("/pending-payments", async (req, res) => {
  if (!canSee(req.user.role, "pending-payments")) return res.status(403).json({ error: "No access" });
  const { country, city } = req.query;
  const clauses = [], params = [];
  if (country) { params.push(country); clauses.push(`country = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await query(`SELECT * FROM pending_payments ${where} ORDER BY status, created_at DESC`, params)).rows
    .map((r) => ({ id: r.id, personId: r.person_id, name: r.name, position: r.position, days: r.days, dailyRate: num(r.daily_rate), amount: num(r.amount), reason: r.reason,
      status: r.status, createdAt: r.created_at, employeeEmail: r.employee_email, managerEmail: r.manager_email,
      employeeSigned: !!r.employee_signed_at, managerSigned: !!r.manager_signed_at, sentAt: r.sent_at, hasPdf: !!r.signed_pdf }));
  res.json(rows);
});

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// POST /api/accounting/pending-payments/:id/send  { managerPhone, employeePhone? }
// Creates the two signing links and sends them over WhatsApp via respond.io.
router.post("/pending-payments/:id/send", async (req, res) => {
  if (!canSee(req.user.role, "pending-payments")) return res.status(403).json({ error: "No access" });
  const p = (await query("SELECT * FROM pending_payments WHERE id=$1", [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.status === "paid") return res.status(400).json({ error: "Already settled" });
  const cfg = await respondConfig();
  let employeePhone = req.body.employeePhone;
  if (!employeePhone && p.person_id) { const c = (await query("SELECT phone FROM candidates WHERE id=$1", [p.person_id])).rows[0]; employeePhone = c && c.phone; }
  const managerPhone = req.body.managerPhone || cfg.managerPhone;
  if (!employeePhone) return res.status(400).json({ error: "No employee WhatsApp number on file — add one on their profile" });
  if (!managerPhone) return res.status(400).json({ error: "No manager number set. Add the manager WhatsApp number in Setup, WhatsApp (respond.io)." });
  const empToken = crypto.randomBytes(24).toString("hex");
  const mgrToken = crypto.randomBytes(24).toString("hex");
  await query("UPDATE pending_payments SET employee_phone=$1, manager_phone=$2, employee_token=$3, manager_token=$4, status='awaiting', sent_at=now() WHERE id=$5",
    [employeePhone, managerPhone, empToken, mgrToken, p.id]);
  const url = baseUrl(req);
  const empLink = `${url}/sign/${empToken}`, mgrLink = `${url}/sign/${mgrToken}`;
  const msg = (role, link) => `storage.ae: please review and sign the final settlement for ${p.name} (AED ${num(p.amount)}) as the ${role}. Open your signature form: ${link}`;
  const params = (role, link) => [p.name, String(num(p.amount)), role, link];
  const tmpl = await settlementTemplate();
  const d1 = await sendWhatsApp({ phone: employeePhone, text: msg("receiver", empLink), params: params("receiver", empLink), template: tmpl, config: cfg });
  const d2 = await sendWhatsApp({ phone: managerPhone, text: msg("payer", mgrLink), params: params("payer", mgrLink), template: tmpl, config: cfg });
  res.json({ ok: true, employeeLink: empLink, managerLink: mgrLink, delivery: { employee: d1, manager: d2 } });
});

// GET /api/accounting/pending-payments/:id/links  (re-fetch the signing links to share/resend)
router.get("/pending-payments/:id/links", async (req, res) => {
  if (!canSee(req.user.role, "pending-payments")) return res.status(403).json({ error: "No access" });
  const p = (await query("SELECT employee_token, manager_token, employee_phone, manager_phone, employee_signed_at, manager_signed_at FROM pending_payments WHERE id=$1", [req.params.id])).rows[0];
  if (!p || !p.employee_token) return res.status(404).json({ error: "Not sent yet" });
  const url = baseUrl(req);
  res.json({ employeeLink: `${url}/sign/${p.employee_token}`, managerLink: `${url}/sign/${p.manager_token}`,
    employeePhone: p.employee_phone, managerPhone: p.manager_phone, employeeSigned: !!p.employee_signed_at, managerSigned: !!p.manager_signed_at });
});

// GET /api/accounting/pending-payments/:id/signed.pdf
router.get("/pending-payments/:id/signed.pdf", async (req, res) => {
  if (!canSee(req.user.role, "pending-payments")) return res.status(403).json({ error: "No access" });
  const p = (await query("SELECT signed_pdf, name FROM pending_payments WHERE id=$1", [req.params.id])).rows[0];
  if (!p || !p.signed_pdf) return res.status(404).json({ error: "Not signed yet" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="settlement-${req.params.id}.pdf"`);
  res.send(p.signed_pdf);
});

// POST /api/accounting/pending-payments/:id/pay   (manual override, admin only)
router.post("/pending-payments/:id/pay", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Manual settle is admin only" });
  const r = await query("UPDATE pending_payments SET status='paid', paid_at=now() WHERE id=$1 RETURNING id", [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

module.exports = router;
