const express = require("express");
const multer = require("multer");
const { pool, query } = require("../db");
const { requireAuth } = require("../auth");
const { KIT_ITEMS, nextOf, canAdvance, canSee, isAdmin, firstDocStage, STAGE_OWNER, ROLES, ownsStage, canReject } = require("../config");
const { generateOfferLetter } = require("../offer");
const { ensureHireUniformOrder } = require("../autoProcurement");
const { notifyTemplate, sendSizesRequest, sendCollectionRequest, notifyMedicalManager, notifyProcurement, notifyTrainingAssignee, sendBookingLink, logDispatch } = require("../notify");
const templates = require("../whatsappTemplates");

const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); return isNaN(dt) ? "" : dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
const fmtTime = (t) => { if (!t) return ""; const m = String(t).match(/^(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : String(t); };

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function shape(row, kitRows, assign) {
  const days = Math.floor((Date.now() - new Date(row.stage_since).getTime()) / 86400000);
  const kit = {};
  KIT_ITEMS.forEach((it) => (kit[it] = "pending"));
  (kitRows || []).forEach((k) => (kit[k.item] = k.status));
  return {
    id: row.id, code: row.code, name: row.name, role: row.job_role, kind: row.kind,
    country: row.country, city: row.city, warehouse: row.warehouse,
    phase: row.phase, stage: row.stage, days, kit, hasCv: !!row.cv_filename, cvName: row.cv_filename,
    salary: row.salary != null ? Number(row.salary) : null,
    startDate: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : null,
    shortlistNotes: row.shortlist_notes || null, trialNotes: row.trial_notes || null,
    rejectReason: row.reject_reason || null, rejectedFrom: row.rejected_from || null, through: row.through || null, stageDurations: row.stage_durations || {},
    collectionSent: !!row.sizes_token, collectionSubmitted: !!row.collection_submitted_at, collectionSubmittedAt: row.collection_submitted_at || null,
    trainingAssignee: assign ? assign.assignee_name : null, trainingAssigneeId: assign ? assign.assignee_id : null,
    trainingDone: assign ? !!assign.completed_at : false,
  };
}
async function loadKit(id) { return (await query("SELECT * FROM kit_orders WHERE candidate_id = $1", [id])).rows; }
async function logEvent(id, type, detail, actor) {
  await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,$2,$3,$4)", [id, type, detail, actor]);
}

// GET /api/candidates?country=&city=&kind=
router.get("/", requireAuth, async (req, res) => {
  const { country, city, kind } = req.query;
  const clauses = [], params = [];
  if (country) { params.push(country); clauses.push(`country = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  if (kind) { params.push(kind); clauses.push(`kind = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const cands = await query(`SELECT * FROM candidates ${where} ORDER BY id`, params);
  const ids = cands.rows.map((r) => r.id);
  let kitBy = {};
  let assignBy = {};
  if (ids.length) {
    const kit = await query("SELECT * FROM kit_orders WHERE candidate_id = ANY($1)", [ids]);
    kit.rows.forEach((k) => (kitBy[k.candidate_id] ||= []).push(k));
    const asg = await query("SELECT * FROM training_assignments WHERE candidate_id = ANY($1)", [ids]);
    asg.rows.forEach((a) => (assignBy[`${a.candidate_id}:${a.stage}`] = a));
  }
  res.json(cands.rows.map((r) => shape(r, kitBy[r.id], assignBy[`${r.id}:${r.stage}`])));
});

// GET /api/candidates/:id
// GET /training-requests -> ad-hoc training work orders (incomplete assignments on active employees)
router.get("/training-requests", requireAuth, async (req, res) => {
  const r = await query(
    `SELECT c.id, c.name, c.job_role, c.warehouse, ta.stage, ta.assignee_name, ta.assigned_by
     FROM training_assignments ta JOIN candidates c ON c.id = ta.candidate_id
     WHERE ta.completed_at IS NULL AND c.kind = 'employee'
     ORDER BY ta.assigned_at DESC`);
  res.json(r.rows.map((x) => ({ id: x.id, name: x.name, role: x.job_role, warehouse: x.warehouse, stage: x.stage, assignee: x.assignee_name || null, source: x.assigned_by })));
});

router.get("/:id", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  if (!c.rows[0]) return res.status(404).json({ error: "Not found" });
  const events = await query("SELECT type, detail, actor, created_at FROM candidate_events WHERE candidate_id = $1 ORDER BY created_at DESC", [req.params.id]);
  res.json({ ...shape(c.rows[0], await loadKit(req.params.id)), events: events.rows });
});

// GET /api/candidates/:id/cv
router.get("/:id/cv", requireAuth, async (req, res) => {
  const c = await query("SELECT cv_filename, cv_mime, cv_bytes FROM candidates WHERE id = $1", [req.params.id]);
  const row = c.rows[0];
  if (!row || !row.cv_bytes) return res.status(404).json({ error: "No CV on file" });
  res.setHeader("Content-Type", row.cv_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${row.cv_filename || "cv"}"`);
  res.send(row.cv_bytes);
});

// POST /api/candidates  (multipart: name, position, country, city, cv?)   HR or admin
router.post("/", requireAuth, upload.single("cv"), async (req, res) => {
  if (!canSee(req.user.role, "applicants")) return res.status(403).json({ error: "Your role cannot add candidates" });
  const { name, position, country, city, phone } = req.body || {};
  if (!name || !position || !country || !city) return res.status(400).json({ error: "name, position, country and city are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const maxIdR = await client.query("SELECT COALESCE(MAX(id),1041) AS m FROM candidates");
    const code = `EMP-${maxIdR.rows[0].m + 1}`;
    const f = req.file;
    const ins = await client.query(
      `INSERT INTO candidates (code, name, job_role, country, city, phone, phase, stage, kind, cv_filename, cv_mime, cv_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,'Recruitment','Pending interview','candidate',$7,$8,$9) RETURNING *`,
      [code, name.trim(), position, country, city, phone || null, f ? f.originalname : null, f ? f.mimetype : null, f ? f.buffer : null]
    );
    const cand = ins.rows[0];
    for (const it of KIT_ITEMS) await client.query("INSERT INTO kit_orders (candidate_id, item, status) VALUES ($1,$2,'pending')", [cand.id, it]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'created',$2,$3)", [cand.id, "Added, pending interview", req.user.name]);
    await client.query("COMMIT");
    // Send the candidate a self-service interview booking link (best-effort, but awaited and logged so a failure is visible).
    if (cand.phone) {
      const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
      await logDispatch(cand.id, "Interview booking link", sendBookingLink(cand, base));
    }
    res.status(201).json(shape(cand, []));
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not create candidate" }); } finally { client.release(); }
});

// helper to move a candidate to a specific stage within recruitment
async function moveTo(res, id, role, expectStages, targetPhase, targetStage, label, actor) {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!expectStages.includes(cand.stage)) return res.status(400).json({ error: `Not valid from ${cand.stage}` });
  if (!ownsStage(role, cand.stage)) return res.status(403).json({ error: "Not your stage to action" });
  await query(`UPDATE candidates SET stage_durations = jsonb_set(coalesce(stage_durations,'{}'::jsonb), ARRAY[stage], to_jsonb( round(coalesce((stage_durations->>stage)::numeric,0) + EXTRACT(EPOCH FROM (now()-coalesce(stage_since,now())))) ), true), phase=$1, stage=$2, stage_since=now() WHERE id=$3`, [targetPhase, targetStage, id]);
  await logEvent(id, "stage", label, actor);
  res.json(shape({ ...cand, phase: targetPhase, stage: targetStage, stage_since: new Date() }, await loadKit(id)));
}

// POST /employee  -> add an existing/active employee directly (skips recruitment)
router.post("/employee", requireAuth, async (req, res) => {
  if (!(isAdmin(req.user.role) || req.user.role === "hr")) return res.status(403).json({ error: "Only admin or HR can add employees" });
  const { name, position, country, city, warehouse, phone, email, salary, startDate, tshirtSize, pantsSize, shoeSize } = req.body || {};
  if (!name || !position || !country || !city) return res.status(400).json({ error: "name, position, country and city are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const maxIdR = await client.query("SELECT COALESCE(MAX(id),1041) AS m FROM candidates");
    const code = `EMP-${maxIdR.rows[0].m + 1}`;
    const ins = await client.query(
      `INSERT INTO candidates (code, name, job_role, country, city, warehouse, phone, email, salary, start_date, phase, stage, kind, tshirt_size, pants_size, shoe_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active','Active','employee',$11,$12,$13) RETURNING *`,
      [code, name.trim(), position, country, city, warehouse || null, phone || null, email || null,
       salary != null && salary !== "" ? Number(String(salary).replace(/,/g,"")) : null, startDate || null, tshirtSize || null, pantsSize || null, shoeSize || null]
    );
    const emp = ins.rows[0];
    // seed a profile so base salary + WhatsApp/contact are consistent with the rest of the app
    await client.query(
      `INSERT INTO employee_profiles (employee_id, phone, email) VALUES ($1,$2,$3)
       ON CONFLICT (employee_id) DO NOTHING`,
      [emp.id, phone || null, email || null]
    );
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'created',$2,$3)", [emp.id, "Added as existing employee", req.user.name]);
    await client.query("COMMIT");
    res.status(201).json(shape(emp, []));
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not add employee" }); } finally { client.release(); }
});

// POST /:id/shortlist  { notes }   Pending interview | Interview | Trial -> Shortlisted
router.post("/:id/shortlist", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!["Pending interview", "Interview", "Trial"].includes(cand.stage)) return res.status(400).json({ error: `Not valid from ${cand.stage}` });
  if (!(isAdmin(req.user.role) || req.user.role === "hr" || ownsStage(req.user.role, cand.stage))) return res.status(403).json({ error: "Not permitted" });
  await query("UPDATE candidates SET stage='Shortlisted', shortlist_notes=$1, stage_since=now() WHERE id=$2", [req.body.notes || null, cand.id]);
  await logEvent(cand.id, "stage", "Shortlisted for later", req.user.name);
  res.json(shape({ ...cand, stage: "Shortlisted", shortlist_notes: req.body.notes, stage_since: new Date() }, await loadKit(cand.id)));
});

// POST /:id/decline  { reason }   cancel a candidate/employee with no worked days
router.post("/:id/decline", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  const allowedStage = ["Pending interview", "Shortlisted", "Interview", "Offer"].includes(cand.stage);
  if (!allowedStage && cand.phase !== "Documentation") return res.status(400).json({ error: `Cannot cancel from ${cand.stage}` });
  if (!(isAdmin(req.user.role) || req.user.role === "hr" || ownsStage(req.user.role, cand.stage))) return res.status(403).json({ error: "Not permitted" });
  await query("UPDATE candidates SET phase='Rejected', stage='Rejected', rejected_from=$2, reject_reason=$3, stage_since=now() WHERE id=$1", [cand.id, cand.stage, req.body.reason || `Cancelled at ${cand.stage}`]);
  await logEvent(cand.id, "reject", `Cancelled at ${cand.stage}`, req.user.name);
  res.json(shape({ ...cand, phase: "Rejected", stage: "Rejected", rejected_from: cand.stage, reject_reason: req.body.reason }, await loadKit(cand.id)));
});

// POST /:id/schedule  { slotId? }  Pending interview | Shortlisted -> Interview
// If a slotId is given, book that interview slot for the candidate.
router.post("/:id/schedule", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!["Pending interview", "Shortlisted"].includes(cand.stage)) return res.status(400).json({ error: `Not valid from ${cand.stage}` });
  if (!ownsStage(req.user.role, cand.stage)) return res.status(403).json({ error: "Not your stage to action" });

  const slotId = req.body && req.body.slotId;
  let notify = null; // captured inside txn, sent after commit
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let detail = "Interview scheduled";
    if (slotId) {
      const s = await client.query("SELECT * FROM interview_slots WHERE id = $1 FOR UPDATE", [slotId]);
      const slot = s.rows[0];
      if (!slot) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Slot not found" }); }
      if (slot.candidate_id) { await client.query("ROLLBACK"); return res.status(409).json({ error: "That slot was just taken" }); }
      const sdt = new Date(`${new Date(slot.slot_date).toISOString().slice(0,10)}T${String(slot.slot_time).slice(0,5)}:00`);
      if (sdt.getTime() < Date.now()) { await client.query("ROLLBACK"); return res.status(400).json({ error: "That slot is in the past" }); }
      await client.query("UPDATE interview_slots SET candidate_id = $1 WHERE id = $2", [cand.id, slotId]);
      detail = `Interview booked for ${new Date(slot.slot_date).toISOString().slice(0, 10)} ${slot.slot_time}`;
      const cal = (await client.query("SELECT cal.phone AS cal_phone, u.name AS owner FROM calendars cal JOIN users u ON u.id = cal.user_id WHERE cal.id=$1", [slot.calendar_id])).rows[0] || {};
      notify = { date: fmtDate(slot.slot_date), time: fmtTime(slot.slot_time), calPhone: cal.cal_phone, owner: cal.owner };
    }
    await client.query("UPDATE candidates SET phase='Recruitment', stage='Interview', stage_since=now() WHERE id=$1", [cand.id]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'stage',$2,$3)", [cand.id, detail, req.user.name]);
    await client.query("COMMIT");
    let wa = null;
    if (notify) {
      const dc = await notifyTemplate({ phone: cand.phone, template: templates.interviewCandidate, params: [cand.name, cand.job_role, notify.date, notify.time] });
      let di = null;
      if (notify.calPhone) di = await notifyTemplate({ phone: notify.calPhone, template: templates.interviewInterviewer, params: [notify.owner || "there", cand.name, cand.job_role, notify.date, notify.time] });
      wa = { candidate: dc, interviewer: di };
    }
    const out = shape({ ...cand, stage: "Interview", stage_since: new Date() }, await loadKit(cand.id));
    out._whatsapp = wa;
    res.json(out);
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not schedule" }); } finally { client.release(); }
});

// POST /:id/reject  { days, dailyRate, reason }  -> mark rejected, owe a pending payment
router.post("/:id/reject", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!canReject(req.user.role, cand.stage)) return res.status(403).json({ error: `Cannot reject from ${cand.stage}` });
  const days = parseInt(req.body.days, 10);
  // Daily rate is derived from the monthly salary automatically: salary / 30.416.
  // A manual dailyRate may still be passed to override; otherwise it's computed.
  const salary = cand.salary != null ? Number(cand.salary) : 0;
  const autoRate = salary > 0 ? salary / 30.416 : 0;
  const rate = req.body.dailyRate != null && req.body.dailyRate !== "" ? parseFloat(req.body.dailyRate) : autoRate;
  if (!(days >= 0) || !(rate >= 0)) return res.status(400).json({ error: "Days are required (daily rate is taken from the salary)" });
  const amount = Math.round(days * rate * 100) / 100;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (amount > 0) {
      await client.query(
        `INSERT INTO pending_payments (person_id, name, position, country, city, days, daily_rate, amount, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cand.id, cand.name, cand.job_role, cand.country, cand.city, days, rate, amount, req.body.reason || `Rejected at ${cand.stage}`, req.user.name]
      );
    }
    await client.query("UPDATE candidates SET phase='Rejected', stage='Rejected', rejected_from=$2, reject_reason=$3, stage_since=now() WHERE id=$1", [cand.id, cand.stage, req.body.reason || `Rejected at ${cand.stage}`]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'reject',$2,$3)", [cand.id, `Rejected at ${cand.stage}, owed ${days}d`, req.user.name]);
    await client.query("COMMIT");
    let wa = null;
    if (req.body.notify && cand.phone) {
      wa = await notifyTemplate({ phone: cand.phone, template: templates.rejectedCandidate, params: [cand.name, cand.job_role] });
    }
    const out = shape({ ...cand, phase: "Rejected", stage: "Rejected", stage_since: new Date() }, await loadKit(cand.id));
    out._whatsapp = wa ? { candidate: wa } : null;
    res.json(out);
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Could not reject" }); } finally { client.release(); }
});

// POST /:id/advance     linear next stage (Interview->Trial, Trial->Offer, docs, onboarding, training)
router.post("/:id/advance", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage === "Offer") return res.status(400).json({ error: "Use accept offer to convert to an employee" });
  if (!canAdvance(req.user.role, cand.stage)) return res.status(403).json({ error: `Only the owner of the ${cand.stage} stage can advance this` });
  const nx = nextOf(cand.country, cand.phase, cand.stage);
  if (!nx) return res.status(400).json({ error: "Already at the final stage" });
  await query(`UPDATE candidates SET stage_durations = jsonb_set(coalesce(stage_durations,'{}'::jsonb), ARRAY[stage], to_jsonb( round(coalesce((stage_durations->>stage)::numeric,0) + EXTRACT(EPOCH FROM (now()-coalesce(stage_since,now())))) ), true), phase=$1, stage=$2, stage_since=now() WHERE id=$3`, [nx.phase, nx.stage, cand.id]);
  await logEvent(cand.id, "advance", `${cand.stage} -> ${nx.stage}`, req.user.name);
  if (cand.stage === "Medical and Tawjeeh") {
    try {
      const created = await ensureHireUniformOrder(cand.id, req.user.name);
      if (created) {
        const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
        const fresh = (await query("SELECT * FROM candidates WHERE id=$1", [cand.id])).rows[0];
        await logDispatch(cand.id, "Uniform sizes request", sendSizesRequest(fresh, base));
        await logDispatch(cand.id, "Procurement order notice", notifyProcurement(fresh));
      }
    } catch (e) { console.error("auto uniform order failed:", e.message); }
  }
  res.json(shape({ ...cand, phase: nx.phase, stage: nx.stage, stage_since: new Date() }, await loadKit(cand.id)));
});

// POST /:id/accept-offer   Offer -> becomes employee, enters Documentation
router.post("/:id/accept-offer", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage !== "Offer") return res.status(400).json({ error: "Only an offer can be accepted" });
  if (!ownsStage(req.user.role, "Offer")) return res.status(403).json({ error: "Only the hiring manager can accept an offer" });
  const doc = firstDocStage(cand.country);
  await query("UPDATE candidates SET kind='employee', phase='Documentation', stage=$1, stage_since=now() WHERE id=$2", [doc, cand.id]);
  await logEvent(cand.id, "convert", "Offer accepted, became employee", req.user.name);
  // If this hire came through a referral, create a manual "Referral bonus" reminder for the referrer.
  if (cand.referrer_phone) {
    try {
      const ref = (await query("SELECT id, name FROM candidates WHERE kind='employee' AND right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),9) = right(regexp_replace($1,'[^0-9]','','g'),9) ORDER BY id LIMIT 1", [cand.referrer_phone])).rows[0];
      if (ref) await query(
        "INSERT INTO employee_requests (employee_id, type, note, status) VALUES ($1,'Referral bonus',$2,'Pending')",
        [ref.id, `${ref.name} referred ${cand.name} (${cand.job_role}) who was hired. Consider a referral bonus.`]);
    } catch (e) { console.error("referral bonus reminder failed", e.message); }
  }
  res.json(shape({ ...cand, kind: "employee", phase: "Documentation", stage: doc, stage_since: new Date() }, await loadKit(cand.id)));
});

// DELETE /api/candidates/:id   admin anyone; HR only candidates
router.delete("/:id", requireAuth, async (req, res) => {
  const c = await query("SELECT kind FROM candidates WHERE id = $1", [req.params.id]);
  if (!c.rows[0]) return res.status(404).json({ error: "Not found" });
  const role = req.user.role;
  const allowed = isAdmin(role) || (role === "hr" && c.rows[0].kind === "candidate");
  if (!allowed) return res.status(403).json({ error: "Your role cannot delete this record" });
  await query("DELETE FROM candidates WHERE id = $1", [req.params.id]);
  res.json({ deleted: true });
});

// POST /:id/trial  { startDate, warehouse, salary, notes }   Interview -> Trial
router.post("/:id/trial", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage !== "Interview") return res.status(400).json({ error: `Not valid from ${cand.stage}` });
  if (!ownsStage(req.user.role, cand.stage)) return res.status(403).json({ error: "Only the hiring manager can start a trial" });
  const { startDate, warehouse, salary, notes, trialDays } = req.body || {};
  await query(
    "UPDATE candidates SET stage='Trial', start_date=$2, warehouse=COALESCE($3, warehouse), salary=$4, trial_notes=$5, stage_since=now() WHERE id=$1",
    [cand.id, startDate || null, warehouse || null, salary != null && salary !== "" ? salary : null, notes || null]
  );
  await logEvent(cand.id, "stage", "Moved to trial", req.user.name);
  const updated = (await query("SELECT * FROM candidates WHERE id=$1", [cand.id])).rows[0];
  const wa = await notifyTemplate({ phone: cand.phone, template: templates.trialCandidate, params: [cand.name, cand.job_role, fmtDate(startDate), trialDays] });
  const out = shape(updated, await loadKit(cand.id));
  out._whatsapp = { candidate: wa };
  res.json(out);
});

// POST /:id/offer  { salary, startDate, warehouse, notes }   Trial -> Offer
router.post("/:id/offer", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage !== "Trial") return res.status(400).json({ error: `Not valid from ${cand.stage}` });
  if (!ownsStage(req.user.role, cand.stage)) return res.status(403).json({ error: "Not your stage to action" });
  const { salary, startDate, warehouse, notes } = req.body || {};
  await query(
    "UPDATE candidates SET stage='Offer', salary=COALESCE($2, salary), start_date=COALESCE($3, start_date), warehouse=COALESCE($4, warehouse), trial_notes=COALESCE($5, trial_notes), stage_since=now() WHERE id=$1",
    [cand.id, salary != null && salary !== "" ? salary : null, startDate || null, warehouse || null, notes || null]
  );
  await logEvent(cand.id, "stage", "Offer made", req.user.name);
  const updated = (await query("SELECT * FROM candidates WHERE id=$1", [cand.id])).rows[0];
  const wa = await notifyTemplate({ phone: cand.phone, template: templates.offerCandidate, params: [cand.name, cand.job_role, updated.salary != null ? String(Number(updated.salary)) : "", fmtDate(updated.start_date)] });
  const out = shape(updated, await loadKit(cand.id));
  out._whatsapp = { candidate: wa };
  res.json(out);
});

// PUT /:id/offer  { salary, startDate, warehouse }   edit an existing offer
router.put("/:id/offer", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage !== "Offer") return res.status(400).json({ error: "Only an open offer can be edited" });
  if (!ownsStage(req.user.role, "Offer")) return res.status(403).json({ error: "Only the hiring manager can edit an offer" });
  const { salary, startDate, warehouse } = req.body || {};
  await query(
    "UPDATE candidates SET salary=$2, start_date=$3, warehouse=COALESCE($4, warehouse) WHERE id=$1",
    [cand.id, salary != null && salary !== "" ? salary : null, startDate || null, warehouse || null]
  );
  await logEvent(cand.id, "offer", "Offer updated", req.user.name);
  const updated = (await query("SELECT * FROM candidates WHERE id=$1", [cand.id])).rows[0];
  const wa = await notifyTemplate({ phone: cand.phone, template: templates.offerCandidate, params: [cand.name, cand.job_role, updated.salary != null ? String(Number(updated.salary)) : "", fmtDate(updated.start_date)] });
  const out = shape(updated, await loadKit(cand.id));
  out._whatsapp = { candidate: wa };
  res.json(out);
});

// POST /:id/reject-offer  { reason }   Offer -> Rejected (no payment)
router.post("/:id/reject-offer", requireAuth, async (req, res) => {
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  const cand = c.rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (cand.stage !== "Offer") return res.status(400).json({ error: "Not an open offer" });
  if (!(isAdmin(req.user.role) || req.user.role === "hr")) return res.status(403).json({ error: "Only HR or admin can reject an offer" });
  await query("UPDATE candidates SET phase='Rejected', stage='Rejected', rejected_from='Offer', reject_reason=$2, stage_since=now() WHERE id=$1", [cand.id, req.body.reason || "Offer declined"]);
  await logEvent(cand.id, "reject", "Offer rejected", req.user.name);
  res.json(shape({ ...cand, phase: "Rejected", stage: "Rejected", rejected_from: "Offer", reject_reason: req.body.reason }, await loadKit(cand.id)));
});

// GET /:id/offer-letter.pdf
router.get("/:id/offer-letter.pdf", requireAuth, async (req, res) => {
  if (!(isAdmin(req.user.role) || req.user.role === "hr")) return res.status(403).json({ error: "No access" });
  const c = await query("SELECT * FROM candidates WHERE id = $1", [req.params.id]);
  if (!c.rows[0]) return res.status(404).json({ error: "Not found" });
  const pdf = await generateOfferLetter(c.rows[0]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="offer-${c.rows[0].code}.pdf"`);
  res.send(pdf);
});

// POST /:id/send-collection  -> WhatsApp the candidate the documents-collection request (+ sizes link)
router.post("/:id/send-collection", requireAuth, async (req, res) => {
  const cand = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.id])).rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  if (!cand.phone) return res.status(400).json({ error: "No WhatsApp number on this candidate" });
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const d = await sendCollectionRequest(cand, base);
  res.json({ ok: true, delivery: d, link: d.link });
});

// POST /:id/notify-medical  -> WhatsApp the manager that this candidate is ready for Medical & Tawjeeh
router.post("/:id/notify-medical", requireAuth, async (req, res) => {
  const cand = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.id])).rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  const d = await notifyMedicalManager(cand);
  res.json({ ok: true, delivery: d });
});

// ---- Training: assign a specific user to a level, they mark it complete ----

const TRAINING = ["Basics", "Safety", "Application"];

// POST /:id/training/assign  { stage, userId }  (admin/hr) -> record + WhatsApp the assignee
router.post("/:id/training/assign", requireAuth, async (req, res) => {
  if (!(isAdmin(req.user.role) || req.user.role === "hr")) return res.status(403).json({ error: "Only admin or HR can assign training" });
  const cand = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.id])).rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  const { stage, userId } = req.body || {};
  if (!TRAINING.includes(stage)) return res.status(400).json({ error: "Unknown training level" });
  const u = (await query("SELECT id, name, phone FROM users WHERE id=$1 AND active=true", [userId])).rows[0];
  if (!u) return res.status(400).json({ error: "Pick an active user to assign" });
  await query(
    `INSERT INTO training_assignments (candidate_id, stage, assignee_id, assignee_name, assigned_by, assigned_at, completed_at)
     VALUES ($1,$2,$3,$4,$5, now(), NULL)
     ON CONFLICT (candidate_id, stage) DO UPDATE SET assignee_id=$3, assignee_name=$4, assigned_by=$5, assigned_at=now(), completed_at=NULL`,
    [cand.id, stage, u.id, u.name, req.user.name]
  );
  await logEvent(cand.id, "training", `${stage} assigned to ${u.name}`, req.user.name);
  const d = await notifyTrainingAssignee(u, stage, cand);
  res.json({ ok: true, delivery: d });
});

// POST /:id/training/complete  { stage }  (assignee or admin) -> mark done + advance
router.post("/:id/training/complete", requireAuth, async (req, res) => {
  const cand = (await query("SELECT * FROM candidates WHERE id=$1", [req.params.id])).rows[0];
  if (!cand) return res.status(404).json({ error: "Not found" });
  const { stage } = req.body || {};
  if (!TRAINING.includes(stage)) return res.status(400).json({ error: "Unknown training level" });
  // ad-hoc training (active employees) may not be at this stage; that is fine.
  const a = (await query("SELECT * FROM training_assignments WHERE candidate_id=$1 AND stage=$2", [cand.id, stage])).rows[0];
  const isAssignee = a && a.assignee_id === req.user.id;
  if (!(isAdmin(req.user.role) || isAssignee)) return res.status(403).json({ error: "Only the assigned trainer or an admin can mark this complete" });
  await query("UPDATE training_assignments SET completed_at=now() WHERE candidate_id=$1 AND stage=$2", [cand.id, stage]);
  if (cand.phase === "Training" && cand.stage === stage) {
    const nx = nextOf(cand.country, cand.phase, cand.stage);
    if (nx) { await query("UPDATE candidates SET phase=$1, stage=$2, stage_since=now() WHERE id=$3", [nx.phase, nx.stage, cand.id]); }
  }
  await logEvent(cand.id, "training", `${stage} completed`, req.user.name);
  const updated = (await query("SELECT * FROM candidates WHERE id=$1", [cand.id])).rows[0];
  res.json(shape(updated, await loadKit(cand.id)));
});

// GET /:id/collection -> the candidate's submitted collection response (sizes, visa, files present)
router.get("/:id/collection", requireAuth, async (req, res) => {
  const c = (await query("SELECT name, tshirt_size, pants_size, shoe_size, visa_status, passport_name, photo_name, collection_submitted_at, (passport_file IS NOT NULL) AS has_passport, (photo_file IS NOT NULL) AS has_photo FROM candidates WHERE id=$1", [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json({
    name: c.name, submittedAt: c.collection_submitted_at, visaStatus: c.visa_status || null,
    tshirt: c.tshirt_size || null, pants: c.pants_size || null, shoe: c.shoe_size || null,
    passport: c.has_passport ? (c.passport_name || "passport") : null,
    photo: c.has_photo ? (c.photo_name || "photo") : null,
  });
});
// GET /:id/collection/passport | /photo -> the file
router.get("/:id/collection/:which(passport|photo)", requireAuth, async (req, res) => {
  const col = req.params.which === "passport" ? "passport" : "photo";
  const c = (await query(`SELECT ${col}_file AS f, ${col}_name AS n FROM candidates WHERE id=$1`, [req.params.id])).rows[0];
  if (!c || !c.f) return res.status(404).json({ error: "No file" });
  res.setHeader("Content-Disposition", `inline; filename="${(c.n || col).replace(/[^\w.\-]/g, "_")}"`);
  res.send(c.f);
});
// ---- Employee documents (uploadable; used by doc processing, profile, expiry) ----
function canDocs(role) { return canSee(role, "documents"); }

// GET /:id/documents  -> list (no bytes)
router.get("/:id/documents", requireAuth, async (req, res) => {
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  const r = await query("SELECT id, label, filename, mime, expiry_date, uploaded_by, uploaded_at FROM employee_documents WHERE employee_id=$1 ORDER BY uploaded_at DESC", [req.params.id]);
  res.json(r.rows.map((d) => ({ id: d.id, label: d.label, filename: d.filename, mime: d.mime, expiry: d.expiry_date ? new Date(d.expiry_date).toISOString().slice(0, 10) : null, uploadedBy: d.uploaded_by, uploadedAt: d.uploaded_at })));
});

// POST /:id/documents  (multipart: file, label, expiry?)
router.post("/:id/documents", requireAuth, upload.single("file"), async (req, res) => {
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  const { label, expiry } = req.body || {};
  const f = req.file;
  if (!label || !f) return res.status(400).json({ error: "label and file are required" });
  const r = await query(
    "INSERT INTO employee_documents (employee_id, label, filename, mime, bytes, expiry_date, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [req.params.id, label, f.originalname, f.mimetype, f.buffer, expiry || null, req.user.name]
  );
  res.status(201).json({ id: r.rows[0].id });
});

// GET /:id/documents/:docId  -> download
router.get("/:id/documents/:docId", requireAuth, async (req, res) => {
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  const r = await query("SELECT filename, mime, bytes FROM employee_documents WHERE id=$1 AND employee_id=$2", [req.params.docId, req.params.id]);
  const d = r.rows[0];
  if (!d || !d.bytes) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", d.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${d.filename || "document"}"`);
  res.send(d.bytes);
});

// DELETE /:id/documents/:docId
router.delete("/:id/documents/:docId", requireAuth, async (req, res) => {
  if (!canDocs(req.user.role)) return res.status(403).json({ error: "No access" });
  await query("DELETE FROM employee_documents WHERE id=$1 AND employee_id=$2", [req.params.docId, req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
