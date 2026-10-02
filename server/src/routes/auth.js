const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const { signToken, requireAuth } = require("../auth");
const { ROLES } = require("../config");

const router = express.Router();

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLES[u.role]?.label || u.role };
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const r = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: "Incorrect email or password" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect email or password" });

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth, async (req, res) => {
  const r = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
  if (!r.rows[0]) return res.status(401).json({ error: "Account not found" });
  res.json({ user: publicUser(r.rows[0]) });
});

module.exports = router;
