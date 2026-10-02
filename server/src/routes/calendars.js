const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../auth");
const { isAdmin } = require("../config");

const router = express.Router();
router.use(requireAuth);

async function ownsCalendar(userId, calendarId) {
  const r = await query("SELECT 1 FROM calendars WHERE id=$1 AND user_id=$2", [calendarId, userId]);
  return r.rows.length > 0;
}

// GET /api/calendars  -> calendars the user may see (admin/hr: all; others: own only)
router.get("/", async (req, res) => {
  const all = req.user.role === "admin" || req.user.role === "hr";
  const r = await query(
    `SELECT c.id, c.name, c.user_id, c.phone, c.start_hour, c.end_hour, c.slot_minutes, u.name AS owner_name
     FROM calendars c JOIN users u ON u.id = c.user_id
     ${all ? "" : "WHERE c.user_id = $1"} ORDER BY c.name`,
    all ? [] : [req.user.id]
  );
  res.json(r.rows.map((c) => ({ id: c.id, name: c.name, userId: c.user_id, phone: c.phone || "", ownerName: c.owner_name, mine: c.user_id === req.user.id, startHour: c.start_hour, endHour: c.end_hour, slotMinutes: c.slot_minutes })));
});

// POST /api/calendars  { name, userId, startHour?, endHour?, slotMinutes? }   admin only
router.post("/", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const { name, userId, phone, startHour, endHour, slotMinutes } = req.body || {};
  if (!name || !userId) return res.status(400).json({ error: "name and userId are required" });
  const r = await query(
    "INSERT INTO calendars (name, user_id, phone, start_hour, end_hour, slot_minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [name, userId, phone || null, startHour || 8, endHour || 18, slotMinutes || 60]
  );
  res.status(201).json(r.rows[0]);
});

// PATCH /api/calendars/:id  { startHour?, endHour?, slotMinutes?, name? }  admin only
router.patch("/:id", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const { startHour, endHour, slotMinutes, name, phone } = req.body || {};
  const sets = [], params = [];
  if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
  if (phone !== undefined) { params.push(phone || null); sets.push(`phone=$${params.length}`); }
  if (startHour !== undefined) { params.push(parseInt(startHour, 10)); sets.push(`start_hour=$${params.length}`); }
  if (endHour !== undefined) { params.push(parseInt(endHour, 10)); sets.push(`end_hour=$${params.length}`); }
  if (slotMinutes !== undefined) { params.push(parseInt(slotMinutes, 10)); sets.push(`slot_minutes=$${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.id);
  await query(`UPDATE calendars SET ${sets.join(", ")} WHERE id=$${params.length}`, params);
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  await query("DELETE FROM calendars WHERE id=$1", [req.params.id]);
  res.json({ deleted: true });
});

// GET /api/calendars/:id/slots
router.get("/:id/slots", async (req, res) => {
  const all = req.user.role === "admin" || req.user.role === "hr";
  if (!all && !(await ownsCalendar(req.user.id, req.params.id))) return res.status(403).json({ error: "No access to this calendar" });
  const r = await query(
    `SELECT s.id, s.slot_date, s.slot_time, s.candidate_id, c.name AS candidate_name, c.job_role AS candidate_role, c.stage AS candidate_stage
     FROM interview_slots s LEFT JOIN candidates c ON c.id = s.candidate_id
     WHERE s.calendar_id = $1 ORDER BY s.slot_date, s.slot_time`, [req.params.id]
  );
  res.json(r.rows.map((s) => {
    const dt = new Date(`${new Date(s.slot_date).toISOString().slice(0, 10)}T${String(s.slot_time).slice(0, 5)}:00`);
    return { id: s.id, date: s.slot_date, time: s.slot_time, candidateId: s.candidate_id, candidateName: s.candidate_name, candidateRole: s.candidate_role, candidateStage: s.candidate_stage, booked: !!s.candidate_id, past: dt.getTime() < Date.now() };
  }));
});

// POST /api/calendars/:id/slots  { date, time }   owner or admin
router.post("/:id/slots", async (req, res) => {
  if (!isAdmin(req.user.role) && !(await ownsCalendar(req.user.id, req.params.id))) return res.status(403).json({ error: "Only the calendar owner can add availability" });
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });
  try {
    const r = await query("INSERT INTO interview_slots (calendar_id, slot_date, slot_time) VALUES ($1,$2,$3) RETURNING id", [req.params.id, date, time]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That slot already exists" });
    throw e;
  }
});

// DELETE /api/calendars/:id/slots/:slotId   owner or admin, only if free
router.delete("/:id/slots/:slotId", async (req, res) => {
  if (!isAdmin(req.user.role) && !(await ownsCalendar(req.user.id, req.params.id))) return res.status(403).json({ error: "Only the calendar owner can remove availability" });
  const s = await query("SELECT candidate_id FROM interview_slots WHERE id=$1", [req.params.slotId]);
  if (s.rows[0] && s.rows[0].candidate_id) return res.status(400).json({ error: "That slot is booked" });
  await query("DELETE FROM interview_slots WHERE id=$1 AND calendar_id=$2", [req.params.slotId, req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
