const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin } = require("../config");

const router = express.Router();

// Only admin manages configurable lists.
function adminOnly(req, res, next) {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  next();
}

const TABLES = {
  positions: { cols: ["name", "team"] },
  cities: { cols: ["country", "name"] },
  warehouses: { cols: ["city", "name"] },
  "bonus-types": { table: "bonus_types", cols: ["name"] },
  "document-types": { table: "document_types", cols: ["name", "notice_days"] },
  "uniform-items": { table: "uniform_items", cols: ["name", "default_qty"] },
};

router.use(requireAuth);

// GET /api/config/:type
router.get("/:type", async (req, res) => {
  const def = TABLES[req.params.type];
  if (!def) return res.status(404).json({ error: "Unknown list" });
  const table = def.table || req.params.type;
  const r = await query(`SELECT * FROM ${table} ORDER BY id`);
  res.json(r.rows);
});

// POST /api/config/:type  { ...cols }
router.post("/:type", adminOnly, async (req, res) => {
  const def = TABLES[req.params.type];
  if (!def) return res.status(404).json({ error: "Unknown list" });
  const table = def.table || req.params.type;
  const values = def.cols.map((c) => (req.body[c] || "").trim());
  if (values.some((v) => !v)) return res.status(400).json({ error: `Required: ${def.cols.join(", ")}` });
  const placeholders = def.cols.map((_, i) => `$${i + 1}`).join(",");
  try {
    const r = await query(`INSERT INTO ${table} (${def.cols.join(",")}) VALUES (${placeholders}) RETURNING *`, values);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That entry already exists" });
    throw e;
  }
});

// PATCH /api/config/:type/:id  { ...cols }
router.patch("/:type/:id", adminOnly, async (req, res) => {
  const def = TABLES[req.params.type];
  if (!def) return res.status(404).json({ error: "Unknown list" });
  const table = def.table || req.params.type;
  const sets = [], params = [];
  for (const c of def.cols) if (req.body[c] !== undefined) { params.push(req.body[c]); sets.push(`${c}=$${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.id);
  const r = await query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id=$${params.length} RETURNING *`, params);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(r.rows[0]);
});

// DELETE /api/config/:type/:id
router.delete("/:type/:id", adminOnly, async (req, res) => {
  const def = TABLES[req.params.type];
  if (!def) return res.status(404).json({ error: "Unknown list" });
  const table = def.table || req.params.type;
  await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
