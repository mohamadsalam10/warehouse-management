const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin, ROLES } = require("../config");

const router = express.Router();
router.use(requireAuth);

function adminOnly(req, res, next) {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  next();
}
const shape = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone || "", role: u.role, roleLabel: ROLES[u.role]?.label || u.role, active: u.active });

router.get("/", adminOnly, async (req, res) => {
  const r = await query("SELECT id, name, email, phone, role, active FROM users ORDER BY id");
  res.json(r.rows.map(shape));
});

router.post("/", adminOnly, async (req, res) => {
  const { name, email, password, role, phone } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: "name, email, password and role are required" });
  if (!ROLES[role]) return res.status(400).json({ error: "Unknown role" });
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await query("INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *", [name, email.toLowerCase(), hash, role, phone || null]);
    res.status(201).json(shape(r.rows[0]));
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A user with that email already exists" });
    throw e;
  }
});

// PATCH /api/users/:id  { role?, active?, password? }
router.patch("/:id", adminOnly, async (req, res) => {
  const { role, active, password, phone } = req.body || {};
  const sets = [], params = [];
  if (role !== undefined) { if (!ROLES[role]) return res.status(400).json({ error: "Unknown role" }); params.push(role); sets.push(`role = $${params.length}`); }
  if (active !== undefined) { params.push(!!active); sets.push(`active = $${params.length}`); }
  if (phone !== undefined) { params.push(phone || null); sets.push(`phone = $${params.length}`); }
  if (password) { params.push(await bcrypt.hash(password, 10)); sets.push(`password_hash = $${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.id);
  const r = await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(shape(r.rows[0]));
});

router.delete("/:id", adminOnly, async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) return res.status(400).json({ error: "You cannot delete your own account" });
  await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
