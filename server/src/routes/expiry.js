const express = require("express");
const { query } = require("../db");
const { defaultLeaveDays } = require("../settings");
const { requireAuth } = require("../auth");
const { canSee } = require("../config");

const router = express.Router();
router.use(requireAuth);

const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const daysUntil = (v) => (v ? Math.ceil((new Date(d10(v) + "T00:00:00Z").getTime() - Date.now()) / 86400000) : null);

function scopeClause(country, city, params, alias = "") {
  const a = alias ? alias + "." : "";
  const cl = [`${a}kind = 'employee'`];
  if (country) { params.push(country); cl.push(`${a}country = $${params.length}`); }
  if (city) { params.push(city); cl.push(`${a}city = $${params.length}`); }
  return cl.join(" AND ");
}

// GET /api/expiry/leaves?country=&city=  -> vacation priority
router.get("/leaves", async (req, res) => {
  if (!canSee(req.user.role, "leave-tracker")) return res.status(403).json({ error: "No access" });
  const { country, city } = req.query;
  const params = [];
  const emps = (await query(`SELECT id, name, job_role, warehouse FROM candidates WHERE ${scopeClause(country, city, params)} ORDER BY name`, params)).rows;
  const ids = emps.map((e) => e.id);
  const profs = {}, taken = {}, planned = {}, bonus = {}, cutoffs = {}, contractEnds = {};
  const GLOBAL_ENT = await defaultLeaveDays();
  if (ids.length) {
    (await query("SELECT employee_id, leave_entitlement, contract_expiry FROM employee_profiles WHERE employee_id = ANY($1)", [ids])).rows.forEach((r) => (profs[r.employee_id] = r));
    (await query(`SELECT c.employee_id, c.created_at, c.end_date,
      EXISTS(SELECT 1 FROM contracts old WHERE old.employee_id=c.employee_id AND old.id<>c.id) AS renewed
      FROM contracts c WHERE c.is_current=true AND c.employee_id=ANY($1)`, [ids])).rows.forEach((r) => {
      cutoffs[r.employee_id] = r.renewed ? new Date(r.created_at).getTime() : null;
      contractEnds[r.employee_id] = r.end_date;
    });
    (await query("SELECT employee_id, days, status, deductible, created_at FROM employee_leaves WHERE employee_id = ANY($1)", [ids])).rows.forEach((r) => {
      if (cutoffs[r.employee_id] != null && new Date(r.created_at).getTime() < cutoffs[r.employee_id]) return;
      if (r.status === "Taken" && r.deductible !== false) taken[r.employee_id] = (taken[r.employee_id] || 0) + Number(r.days);
      if (r.status === "Planned") planned[r.employee_id] = (planned[r.employee_id] || 0) + Number(r.days);
    });
    (await query("SELECT employee_id, days, created_at FROM leave_compensations WHERE employee_id = ANY($1)", [ids])).rows.forEach((r) => {
      if (cutoffs[r.employee_id] != null && new Date(r.created_at).getTime() < cutoffs[r.employee_id]) return;
      bonus[r.employee_id] = (bonus[r.employee_id] || 0) + Number(r.days);
    });
  }
  const rows = emps.map((e) => {
    const pr = profs[e.id] || {};
    const entitlement = GLOBAL_ENT;
    const tk = taken[e.id] || 0;
    const booked = planned[e.id] || 0;
    const added = bonus[e.id] || 0;
    const remaining = entitlement + added - tk - booked;
    const contractExpiry = d10(contractEnds[e.id] || pr.contract_expiry);
    const contractDaysLeft = daysUntil(contractEnds[e.id] || pr.contract_expiry);
    // Lower score = more urgent: little contract time left with lots of leave still owed.
    const score = (contractDaysLeft != null ? contractDaysLeft : 100000) - remaining;
    return { id: e.id, name: e.name, position: e.job_role, warehouse: e.warehouse, entitlement, added, taken: tk, planned: booked, remaining, contractExpiry, contractDaysLeft, score };
  }).sort((a, b) => a.score - b.score);
  rows.forEach((r, i) => { r.priority = i + 1; });
  res.json(rows);
});

// GET /api/expiry/documents?country=&city=  -> document-expiry work orders
router.get("/documents", async (req, res) => {
  if (!canSee(req.user.role, "doc-expiry")) return res.status(403).json({ error: "No access" });
  const { country, city } = req.query;
  const types = {};
  (await query("SELECT name, notice_days FROM document_types")).rows.forEach((t) => (types[t.name] = t.notice_days));
  const params = [];
  const rows = (await query(
    `SELECT d.id, d.label, d.expiry_date, c.id AS employee_id, c.name AS emp_name, c.job_role, c.warehouse
     FROM employee_documents d JOIN candidates c ON c.id = d.employee_id
     WHERE d.expiry_date IS NOT NULL AND ${scopeClause(country, city, params, "c")}
     ORDER BY d.expiry_date ASC`, params
  )).rows;
  const out = [];
  for (const r of rows) {
    const daysLeft = daysUntil(r.expiry_date);
    const notice = types[r.label] != null ? types[r.label] : 30;
    if (daysLeft <= notice) out.push({ id: r.id, employeeId: r.employee_id, employee: r.emp_name, position: r.job_role, warehouse: r.warehouse, document: r.label, expiry: d10(r.expiry_date), daysLeft, notice, status: daysLeft < 0 ? "expired" : "expiring" });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  res.json(out);
});

module.exports = router;
