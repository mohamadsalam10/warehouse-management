// Custom roles with per-page access. Admin only. Admin role is protected (always full access).
const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin, applyRoles, PAGE_CATALOG } = require("../config");

const router = express.Router();
router.use(requireAuth);

async function reload() { const r = await query("SELECT * FROM roles"); applyRoles(r.rows); return r.rows; }
const view = (r) => ({ key: r.key, label: r.label, pages: r.is_admin ? "*" : (Array.isArray(r.pages) ? r.pages : []), isAdmin: r.is_admin, protected: r.protected });

// GET /api/roles -> roles + the catalog of assignable pages
router.get("/", async (req, res) => {
  const rows = (await query("SELECT * FROM roles ORDER BY is_admin DESC, key")).rows;
  res.json({ roles: rows.map(view), pages: PAGE_CATALOG });
});

// POST /api/roles { key, label, pages: [] }
router.post("/", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  let { key, label, pages } = req.body || {};
  key = String(key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!key || !label) return res.status(400).json({ error: "A key and a label are required" });
  const exists = (await query("SELECT 1 FROM roles WHERE key=$1", [key])).rows[0];
  if (exists) return res.status(409).json({ error: "A role with that key already exists" });
  const valid = new Set(PAGE_CATALOG.map((p) => p.id));
  const pgs = (Array.isArray(pages) ? pages : []).filter((p) => valid.has(p));
  await query("INSERT INTO roles (key, label, pages, is_admin, protected) VALUES ($1,$2,$3,false,false)", [key, label.trim(), JSON.stringify(pgs)]);
  await reload();
  res.status(201).json({ ok: true, key });
});

// PUT /api/roles/:key { label?, pages? }  (cannot edit admin's access)
router.put("/:key", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const r = (await query("SELECT * FROM roles WHERE key=$1", [req.params.key])).rows[0];
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.is_admin) return res.status(400).json({ error: "The admin role always has full access and can't be changed" });
  const { label, pages } = req.body || {};
  const valid = new Set(PAGE_CATALOG.map((p) => p.id));
  const pgs = pages !== undefined ? (Array.isArray(pages) ? pages : []).filter((p) => valid.has(p)) : (Array.isArray(r.pages) ? r.pages : []);
  await query("UPDATE roles SET label=$1, pages=$2 WHERE key=$3", [label != null ? String(label).trim() : r.label, JSON.stringify(pgs), r.key]);
  await reload();
  res.json({ ok: true });
});

// DELETE /api/roles/:key  (not protected, and not in use)
router.delete("/:key", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const r = (await query("SELECT * FROM roles WHERE key=$1", [req.params.key])).rows[0];
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.protected || r.is_admin) return res.status(400).json({ error: "This role can't be deleted" });
  const inUse = (await query("SELECT 1 FROM users WHERE role=$1 LIMIT 1", [req.params.key])).rows[0];
  if (inUse) return res.status(400).json({ error: "Some users still have this role; reassign them first" });
  await query("DELETE FROM roles WHERE key=$1", [req.params.key]);
  await reload();
  res.json({ deleted: true });
});

module.exports = router;
