const express = require("express");
const { pool, query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin } = require("../config");

const router = express.Router();
router.use(requireAuth);
const canManage = (role) => isAdmin(role) || role === "hr";
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

function view(r) {
  return { id: r.id, employeeId: r.employee_id, employee: r.emp_name, position: r.job_role, warehouse: r.warehouse,
    type: r.type, startDate: d10(r.start_date), endDate: d10(r.end_date), days: r.days, item: r.item, size: r.size, quantity: r.quantity,
    note: r.note, status: r.status, decidedBy: r.decided_by, decisionNote: r.decision_note, createdAt: d10(r.created_at),
    hasReport: !!r.report_filename, reportApproved: r.report_approved };
}

// GET /api/requests?country=&city=&status=
router.get("/", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const { country, city, status } = req.query;
  const cl = [], params = [];
  if (country) { params.push(country); cl.push(`c.country = $${params.length}`); }
  if (city) { params.push(city); cl.push(`c.city = $${params.length}`); }
  if (status) { params.push(status); cl.push(`r.status = $${params.length}`); }
  const where = cl.length ? `WHERE ${cl.join(" AND ")}` : "";
  const rows = (await query(
    `SELECT r.id, r.employee_id, r.type, r.start_date, r.end_date, r.days, r.item, r.size, r.quantity, r.note,
            r.status, r.decided_by, r.decision_note, r.created_at, r.report_filename, r.report_approved,
            c.name AS emp_name, c.job_role, c.warehouse
     FROM employee_requests r JOIN candidates c ON c.id = r.employee_id
     ${where} ORDER BY (r.status='Pending') DESC, r.created_at DESC`, params
  )).rows;
  res.json(rows.map(view));
});

// GET /api/requests/:id/report  (manager downloads an employee's medical report)
router.get("/:id/report", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const r = (await query("SELECT report_filename, report_mime, report_bytes FROM employee_requests WHERE id=$1", [req.params.id])).rows[0];
  if (!r || !r.report_bytes) return res.status(404).json({ error: "No report" });
  res.setHeader("Content-Type", r.report_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${r.report_filename || "medical-report"}"`);
  res.send(r.report_bytes);
});

// POST /api/requests/:id/approve  { note?, medicalApproved? }
router.post("/:id/approve", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const r = (await query("SELECT * FROM employee_requests WHERE id=$1", [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "Pending") return res.status(400).json({ error: "Already decided" });
  const medicalApproved = req.body.medicalApproved === true || req.body.medicalApproved === "true";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (r.type === "Vacation" || r.type === "Sick leave") {
      const lType = r.type === "Sick leave" ? "Sick" : "Annual";
      const lStatus = r.type === "Sick leave" ? "Taken" : "Planned";
      // Sick leave with an approved medical report is excused: recorded but not deducted.
      const deductible = r.type === "Sick leave" ? !medicalApproved : true;
      const noteTxt = r.type === "Sick leave" ? (medicalApproved ? "Excused: medical report approved" : "Deducted: no approved medical report") : (r.note || "Approved from request");
      await client.query(
        "INSERT INTO employee_leaves (employee_id, start_date, end_date, days, type, status, deductible, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [r.employee_id, r.start_date, r.end_date, r.days || 0, lType, lStatus, deductible, noteTxt, req.user.name]
      );
      if (r.type === "Sick leave") await client.query("UPDATE employee_requests SET report_approved=$1 WHERE id=$2", [medicalApproved, r.id]);
    } else if (r.type === "Uniform") {
      const ord = await client.query("INSERT INTO procurement_orders (employee_id, status, created_by) VALUES ($1,'pending',$2) RETURNING id", [r.employee_id, req.user.name]);
      await client.query("INSERT INTO procurement_order_items (order_id, item, size, quantity) VALUES ($1,$2,$3,$4)", [ord.rows[0].id, r.item, r.size || null, r.quantity || 1]);
    }
    const decision = req.body.note || (r.type === "Sick leave" ? (medicalApproved ? "Medical report approved — leave excused" : "Medical report not approved — leave deducted") : null);
    await client.query("UPDATE employee_requests SET status='Approved', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3", [req.user.name, decision, r.id]);
    if (r.type === "Reimbursement" && r.amount != null) {
      const emp = (await client.query("SELECT name, job_role, country, city FROM candidates WHERE id=$1", [r.employee_id])).rows[0] || {};
      await client.query(
        `INSERT INTO pending_payments (person_id, name, position, country, city, days, daily_rate, amount, reason, status, created_by)
         VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,'pending',$8)`,
        [r.employee_id, emp.name, emp.job_role, emp.country, emp.city, r.amount, `Reimbursement: ${r.note || "approved"}`, req.user.name]);
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not approve" }); } finally { client.release(); }
});

// POST /api/requests/:id/reject  { note }
router.post("/:id/reject", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const r = await query("UPDATE employee_requests SET status='Rejected', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3 AND status='Pending' RETURNING id", [req.user.name, req.body.note || null, req.params.id]);
  if (!r.rows[0]) return res.status(400).json({ error: "Already decided or not found" });
  res.json({ ok: true });
});

module.exports = router;
