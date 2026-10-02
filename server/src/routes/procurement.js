const express = require("express");
const { pool, query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin, canSee } = require("../config");
const { sendSizesRequest, notifyProcurement, logDispatch } = require("../notify");

const router = express.Router();
router.use(requireAuth);

const canManage = (role) => isAdmin(role) || role === "procurement" || role === "hr";
const canView = (role) => canManage(role) || role === "ld" || canSee(role, "employees");
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

function orderView(o, items) {
  return { id: o.id, employeeId: o.employee_id, employee: o.emp_name, position: o.job_role, warehouse: o.warehouse,
    status: o.status, auto: o.auto, createdAt: d10(o.created_at), orderedAt: d10(o.ordered_at), receivedAt: d10(o.received_at),
    items: (items || []).map((i) => ({ id: i.id, item: i.item, size: i.size, quantity: i.quantity })) };
}

// GET /api/procurement/orders?country=&city=&status=&employeeId=&category=
router.get("/orders", async (req, res) => {
  if (!canView(req.user.role)) return res.status(403).json({ error: "No access" });
  const { country, city, status, employeeId, category } = req.query;
  if (category && !["uniform", "facility"].includes(category)) return res.status(400).json({ error: "Invalid category" });
  const cl = [], params = [];
  if (employeeId) { params.push(employeeId); cl.push(`p.employee_id = $${params.length}`); }
  if (category) { params.push(category); cl.push(`COALESCE(p.category, 'uniform') = $${params.length}`); }
  if (country) { params.push(country); cl.push(`c.country = $${params.length}`); }
  if (city) { params.push(city); cl.push(`c.city = $${params.length}`); }
  if (status) { params.push(status); cl.push(`p.status = $${params.length}`); }
  const where = cl.length ? `WHERE ${cl.join(" AND ")}` : "";
  const orders = (await query(
    `SELECT p.*, c.name AS emp_name, c.job_role, c.warehouse
     FROM procurement_orders p JOIN candidates c ON c.id = p.employee_id
     ${where} ORDER BY p.status, p.created_at DESC`, params
  )).rows;
  const ids = orders.map((o) => o.id);
  let itemsBy = {};
  if (ids.length) {
    (await query("SELECT * FROM procurement_order_items WHERE order_id = ANY($1) ORDER BY id", [ids])).rows.forEach((i) => (itemsBy[i.order_id] ||= []).push(i));
  }
  res.json(orders.map((o) => orderView(o, itemsBy[o.id])));
});

// POST /api/procurement/orders  { employeeId, items: [{item,size,quantity}] }  -> one work order
router.post("/orders", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const { employeeId, items } = req.body || {};
  const lines = (items || []).filter((l) => l && l.item);
  if (!employeeId || !lines.length) return res.status(400).json({ error: "employee and at least one item are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ord = await client.query("INSERT INTO procurement_orders (employee_id, status, created_by) VALUES ($1,'pending',$2) RETURNING id", [employeeId, req.user.name]);
    const orderId = ord.rows[0].id;
    for (const l of lines) await client.query("INSERT INTO procurement_order_items (order_id, item, size, quantity) VALUES ($1,$2,$3,$4)", [orderId, l.item, l.size || null, l.quantity ? parseInt(l.quantity, 10) : 1]);
    await client.query("COMMIT");
    try { const cand = (await query("SELECT * FROM candidates WHERE id=$1", [employeeId])).rows[0]; if (cand) await logDispatch(cand.id, "Procurement order notice", notifyProcurement(cand)); } catch (e) { console.error("procurement notify failed", e.message); }
    res.status(201).json({ id: orderId });
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not create order" }); } finally { client.release(); }
});

// PATCH /api/procurement/orders/:id  { status }
router.patch("/orders/:id", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const { status } = req.body || {};
  if (!["pending", "ordered", "received"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const stamp = status === "ordered" ? ", ordered_at = now()" : status === "received" ? ", received_at = now()" : "";
  const r = await query(`UPDATE procurement_orders SET status=$1${stamp} WHERE id=$2 RETURNING id`, [status, req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// PATCH /api/procurement/orders/:id/items/:itemId  { size, quantity }
router.patch("/orders/:id/items/:itemId", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const { size, quantity } = req.body || {};
  const sets = [], params = [];
  if (size !== undefined) { params.push(size || null); sets.push(`size=$${params.length}`); }
  if (quantity !== undefined) { params.push(quantity ? parseInt(quantity, 10) : 1); sets.push(`quantity=$${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.itemId, req.params.id);
  await query(`UPDATE procurement_order_items SET ${sets.join(", ")} WHERE id=$${params.length - 1} AND order_id=$${params.length}`, params);
  res.json({ ok: true });
});

// DELETE /api/procurement/orders/:id
router.delete("/orders/:id", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  await query("DELETE FROM procurement_orders WHERE id=$1", [req.params.id]);
  res.json({ deleted: true });
});

// POST /api/procurement/orders/:id/request-sizes  -> WhatsApp the employee a link to enter sizes
router.post("/orders/:id/request-sizes", async (req, res) => {
  if (!canManage(req.user.role)) return res.status(403).json({ error: "No access" });
  const ord = (await query("SELECT employee_id FROM procurement_orders WHERE id=$1", [req.params.id])).rows[0];
  if (!ord) return res.status(404).json({ error: "Not found" });
  const cand = (await query("SELECT * FROM candidates WHERE id=$1", [ord.employee_id])).rows[0];
  if (!cand) return res.status(404).json({ error: "Employee not found" });
  if (!cand.phone) return res.status(400).json({ error: "No WhatsApp number on this employee's profile" });
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const d = await sendSizesRequest(cand, base);
  res.json({ ok: true, delivery: d, link: d.link });
});

module.exports = router;
