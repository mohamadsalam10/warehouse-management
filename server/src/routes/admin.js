// Admin-only maintenance actions.
const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin } = require("../config");

const router = express.Router();
router.use(requireAuth);

// POST /api/admin/clear-all  { confirm: "DELETE" }
// Wipes all people and operational records. Keeps users, roles, config lists and settings.
router.post("/clear-all", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  if ((req.body && req.body.confirm) !== "DELETE") return res.status(400).json({ error: "Type DELETE to confirm" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE interview_slots SET candidate_id = NULL");
    const tables = [
      "pending_payments", "salary_sheets", "employee_requests", "employee_leaves",
      "employee_documents", "employee_profiles", "procurement_order_items", "procurement_orders",
      "training_assignments", "kit_orders", "candidate_events", "candidates",
    ];
    for (const t of tables) { try { await client.query(`DELETE FROM ${t}`); } catch (e) { /* table may not exist */ } }
    await client.query("COMMIT");
    res.json({ ok: true, cleared: true });
  } catch (e) { await client.query("ROLLBACK"); console.error("clear-all failed", e.message); res.status(500).json({ error: "Could not clear data" }); } finally { client.release(); }
});

module.exports = router;
