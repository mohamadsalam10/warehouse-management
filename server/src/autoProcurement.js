const { query } = require("./db");

// Create the standard uniform work order for a new hire, once. Quantities come from
// uniform_items.default_qty; item sizes are prefilled from the employee's saved sizes if present.
async function ensureHireUniformOrder(employeeId, actor) {
  const existing = await query("SELECT 1 FROM procurement_orders WHERE employee_id=$1 AND auto=true", [employeeId]);
  if (existing.rows.length) return null;
  const items = (await query("SELECT name, default_qty FROM uniform_items WHERE default_qty > 0 ORDER BY name")).rows;
  if (!items.length) return null;
  const cand = (await query("SELECT shoe_size, pants_size, tshirt_size FROM candidates WHERE id=$1", [employeeId])).rows[0] || {};
  const sizeFor = (name) => {
    const n = (name || "").toLowerCase();
    if (n.includes("shirt") || n.includes("tee") || n.includes("polo")) return cand.tshirt_size || null;
    if (n.includes("pant") || n.includes("trouser") || n.includes("bottom")) return cand.pants_size || null;
    if (n.includes("shoe") || n.includes("boot") || n.includes("footwear")) return cand.shoe_size || null;
    return null;
  };
  const ord = await query("INSERT INTO procurement_orders (employee_id, status, auto, created_by) VALUES ($1,'pending',true,$2) RETURNING id", [employeeId, actor || "System"]);
  const orderId = ord.rows[0].id;
  for (const it of items) await query("INSERT INTO procurement_order_items (order_id, item, size, quantity) VALUES ($1,$2,$3,$4)", [orderId, it.name, sizeFor(it.name), it.default_qty]);
  return orderId;
}

module.exports = { ensureHireUniformOrder };
