const express = require("express");
const { query } = require("../db");
const { requireAuth, requirePage } = require("../auth");
const { KIT_ITEMS, KIT_NEXT } = require("../config");

const router = express.Router();

// POST /api/candidates/:id/kit  { item }  -> cycles pending/ordered/received
// Gated to roles that can see the procurement page (procurement, admin).
router.post("/:id/kit", requireAuth, requirePage("procurement"), async (req, res) => {
  const { item } = req.body || {};
  if (!KIT_ITEMS.includes(item)) return res.status(400).json({ error: "Unknown kit item" });

  const cur = await query("SELECT status FROM kit_orders WHERE candidate_id = $1 AND item = $2", [req.params.id, item]);
  const status = cur.rows[0] ? cur.rows[0].status : "pending";
  const next = KIT_NEXT[status];

  await query(
    `INSERT INTO kit_orders (candidate_id, item, status, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (candidate_id, item) DO UPDATE SET status = $3, updated_at = now()`,
    [req.params.id, item, next]
  );
  await query(
    "INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'kit',$2,$3)",
    [req.params.id, `${item}: ${next}`, req.user.name]
  );
  res.json({ item, status: next });
});

module.exports = router;
