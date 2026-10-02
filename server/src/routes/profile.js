const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { pool, query } = require("../db");
const ticketUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const { defaultLeaveDays } = require("../settings");
const { requireAuth } = require("../auth");
const { isAdmin, canSee } = require("../config");

const router = express.Router();
router.use(requireAuth);

const canView = (role) => isAdmin(role) || role === "hr" || canSee(role, "employees");
const canEdit = (role) => isAdmin(role) || role === "hr";
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function profileView(row, cand) {
  const r = row || {};
  const c = cand || {};
  return {
    dateOfBirth: d10(r.date_of_birth), nationality: r.nationality || "", gender: r.gender || "", maritalStatus: r.marital_status || "",
    passportNo: r.passport_no || "", emiratesIdNo: r.emirates_id_no || "",
    phone: (r.phone || c.phone || ""), email: r.email || "", address: r.address || "",
    emergencyName: r.emergency_name || "", emergencyRelation: r.emergency_relation || "", emergencyPhone: r.emergency_phone || "",
    contractStart: d10(r.contract_start), contractExpiry: d10(r.contract_expiry),
    leaveEntitlement: r.leave_entitlement != null ? r.leave_entitlement : 30,
  };
}
function leavesSummary(leaves, entitlement, bonus) {
  const taken = leaves.filter((l) => l.status === "Taken" && l.deductible !== false).reduce((s, l) => s + Number(l.days), 0);
  const planned = leaves.filter((l) => l.status === "Planned").reduce((s, l) => s + Number(l.days), 0);
  const bonusDays = bonus || 0;
  return { entitlement, accrued: entitlement, taken, planned, remaining: entitlement + bonusDays - taken - planned, bonusDays };
}

function recordContractId(createdAt, contracts) {
  if (!contracts.length) return null;
  const date = new Date(createdAt).getTime();
  return (contracts.find((c) => date >= new Date(c.created_at).getTime()) || contracts[contracts.length - 1]).id;
}

// GET /:id/profile  (aggregate)
router.get("/:id/profile", async (req, res) => {
  if (!canView(req.user.role)) return res.status(403).json({ error: "No access" });
  const id = req.params.id;
  const c = (await query("SELECT * FROM candidates WHERE id=$1", [id])).rows[0];
  if (!c) return res.status(404).json({ error: "Not found" });
  const prof = (await query("SELECT * FROM employee_profiles WHERE employee_id=$1", [id])).rows[0];
  const docs = (await query("SELECT id, label, filename, expiry_date, uploaded_by, uploaded_at FROM employee_documents WHERE employee_id=$1 ORDER BY uploaded_at DESC", [id])).rows
    .map((x) => ({ id: x.id, label: x.label, filename: x.filename, expiry: d10(x.expiry_date), uploadedBy: x.uploaded_by }));
  const rawLeaves = (await query("SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY start_date DESC NULLS LAST, id DESC", [id])).rows;
  const { currentContract } = require("../contracts");
  let contract = null, bonus = 0, comps = [], contracts = [];
  try {
    contract = c.kind === "employee" ? await currentContract(id) : null;
    comps = (await query("SELECT id, comp_date, days, note, created_by, created_at FROM leave_compensations WHERE employee_id=$1 ORDER BY comp_date DESC NULLS LAST, id DESC", [id])).rows
      .map((x) => ({ id: x.id, date: d10(x.comp_date), days: Number(x.days), note: x.note, by: x.created_by, createdAt: x.created_at }));
    contracts = (await query("SELECT id, start_date, end_date, created_at, is_current, ticket_status, (ticket_file IS NOT NULL) AS has_ticket, closed_at, snapshot_entitlement, snapshot_taken, snapshot_unused, settled_used, settled_reimbursed FROM contracts WHERE employee_id=$1 ORDER BY created_at DESC, id DESC", [id])).rows
      .map((x) => ({ id: x.id, startDate: d10(x.start_date), endDate: d10(x.end_date), created_at: x.created_at, isCurrent: x.is_current, ticketStatus: x.ticket_status, hasTicket: x.has_ticket, closedAt: x.closed_at, entitlement: x.snapshot_entitlement, deducted: x.snapshot_taken, unused: x.snapshot_unused == null ? null : Number(x.snapshot_unused), used: Number(x.settled_used || 0), reimbursed: Number(x.settled_reimbursed || 0), remaining: x.snapshot_unused != null ? Math.max(0, Number(x.snapshot_unused) - Number(x.settled_used || 0) - Number(x.settled_reimbursed || 0)) : null }));
    if (contracts.length) {
      const adjustments = (await query("SELECT id, contract_id, kind, days, start_date, end_date, created_at, created_by FROM contract_settlements WHERE contract_id=ANY($1) ORDER BY created_at DESC, id DESC", [contracts.map((x) => x.id)])).rows;
      for (const ct of contracts) ct.settlements = adjustments.filter((x) => x.contract_id === ct.id).map((x) => ({ id: x.id, kind: x.kind, days: Number(x.days), startDate: d10(x.start_date), endDate: d10(x.end_date), recordedAt: d10(x.created_at), by: x.created_by }));
    }
  } catch (e) { console.error("contracts/comp load failed", e.message); }
  const leaves = rawLeaves.map((l) => ({ id: l.id, startDate: d10(l.start_date), endDate: d10(l.end_date), days: l.days, type: l.type, status: l.status, notes: l.notes, deductible: l.deductible !== false, contractId: recordContractId(l.created_at, contracts) }));
  comps = comps.map(({ createdAt, ...x }) => ({ ...x, contractId: recordContractId(createdAt, contracts) }));
  if (contract) bonus = comps.filter((x) => x.contractId === contract.id).reduce((s, x) => s + x.days, 0);
  const pv = profileView(prof, c);
  if (contract) { pv.contractStart = d10(contract.start_date); pv.contractExpiry = d10(contract.end_date); }
  res.json({
    core: { id: c.id, code: c.code, name: c.name, position: c.job_role, kind: c.kind, phase: c.phase, stage: c.stage, country: c.country, city: c.city, warehouse: c.warehouse, salary: c.salary != null ? Number(c.salary) : null, startDate: d10(c.start_date), email: c.email || "", phone: c.phone || "", shoeSize: c.shoe_size || "", pantsSize: c.pants_size || "", tshirtSize: c.tshirt_size || "", insuranceExpiry: c.insurance_expiry ? new Date(c.insurance_expiry).toISOString().slice(0,10) : "", portalEmail: c.portal_email || "", portalEnabled: !!c.portal_password_hash },
    profile: pv, documents: docs, leaves, comps, contracts, currentContractId: contract ? contract.id : null,
    leaveSummary: leavesSummary(leaves.filter((l) => l.contractId === (contract ? contract.id : null)), await defaultLeaveDays(), bonus),
    canEdit: canEdit(req.user.role),
  });
});

// POST /:id/portal  { email, password? }   enable/update employee portal login
router.post("/:id/portal", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const { email, password } = req.body || {};
  if (!email) return res.status(400).json({ error: "A login email is required" });
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await query("UPDATE candidates SET portal_email=$1, portal_password_hash=$2 WHERE id=$3", [email.toLowerCase(), hash, req.params.id]);
    } else {
      await query("UPDATE candidates SET portal_email=$1 WHERE id=$2", [email.toLowerCase(), req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That login email is already in use" });
    throw e;
  }
});

// PUT /:id/profile
router.put("/:id/profile", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const b = req.body || {};
  if (b.contractStart && b.contractExpiry && b.contractExpiry < b.contractStart) return res.status(400).json({ error: "Contract end must be on or after its start" });
  const vals = [req.params.id, b.dateOfBirth || null, b.nationality || null, b.gender || null, b.maritalStatus || null,
    b.passportNo || null, b.emiratesIdNo || null, b.phone || null, b.email || null, b.address || null,
    b.emergencyName || null, b.emergencyRelation || null, b.emergencyPhone || null,
    b.contractStart || null, b.contractExpiry || null, b.leaveEntitlement != null && b.leaveEntitlement !== "" ? parseInt(b.leaveEntitlement, 10) : 30];
  await query(
    `INSERT INTO employee_profiles (employee_id, date_of_birth, nationality, gender, marital_status, passport_no, emirates_id_no, phone, email, address, emergency_name, emergency_relation, emergency_phone, contract_start, contract_expiry, leave_entitlement, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
     ON CONFLICT (employee_id) DO UPDATE SET date_of_birth=$2, nationality=$3, gender=$4, marital_status=$5, passport_no=$6, emirates_id_no=$7, phone=$8, email=$9, address=$10, emergency_name=$11, emergency_relation=$12, emergency_phone=$13, contract_start=$14, contract_expiry=$15, leave_entitlement=$16, updated_at=now()`,
    vals
  );
  if (b.contractStart) await query("UPDATE contracts SET start_date=$1, end_date=$2 WHERE employee_id=$3 AND is_current=true", [b.contractStart, b.contractExpiry || null, req.params.id]);
  if (b.salary !== undefined) await query("UPDATE candidates SET salary=$1 WHERE id=$2", [b.salary != null && b.salary !== "" ? Number(String(b.salary).replace(/,/g, "")) : null, req.params.id]);
  if (b.email !== undefined) await query("UPDATE candidates SET email=$1 WHERE id=$2", [b.email || null, req.params.id]);
  if (b.phone !== undefined) await query("UPDATE candidates SET phone=$1 WHERE id=$2", [b.phone || null, req.params.id]);
  if (b.position !== undefined && b.position) await query("UPDATE candidates SET job_role=$1 WHERE id=$2", [b.position, req.params.id]);
  if (b.warehouse !== undefined) await query("UPDATE candidates SET warehouse=$1 WHERE id=$2", [b.warehouse || null, req.params.id]);
  if (b.startDate !== undefined) await query("UPDATE candidates SET start_date=$1 WHERE id=$2", [b.startDate || null, req.params.id]);
  if (b.insuranceExpiry !== undefined) await query("UPDATE candidates SET insurance_expiry=$1 WHERE id=$2", [b.insuranceExpiry || null, req.params.id]);
  if (b.shoeSize !== undefined) await query("UPDATE candidates SET shoe_size=$1 WHERE id=$2", [b.shoeSize || null, req.params.id]);
  if (b.pantsSize !== undefined) await query("UPDATE candidates SET pants_size=$1 WHERE id=$2", [b.pantsSize || null, req.params.id]);
  if (b.tshirtSize !== undefined) await query("UPDATE candidates SET tshirt_size=$1 WHERE id=$2", [b.tshirtSize || null, req.params.id]);
  res.json({ ok: true });
});

// POST /:id/compensation  { compDate, days?, note }  -> record an extra (compensated) leave day
router.post("/:id/compensation", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const days = req.body.days != null && req.body.days !== "" ? Number(req.body.days) : 1;
  if (!(days > 0)) return res.status(400).json({ error: "Days must be greater than 0" });
  const r = await query("INSERT INTO leave_compensations (employee_id, comp_date, days, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [req.params.id, req.body.compDate || null, days, req.body.note || null, req.user.name]);
  await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'leave',$2,$3)",
    [req.params.id, `Compensated ${days} day(s)${req.body.compDate ? ` for ${req.body.compDate}` : ""}${req.body.note ? ` — ${req.body.note}` : ""}`, req.user.name]);
  res.status(201).json({ ok: true, id: r.rows[0].id });
});
router.delete("/:id/compensation/:compId", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  await query("DELETE FROM leave_compensations WHERE id=$1 AND employee_id=$2", [req.params.compId, req.params.id]);
  res.json({ deleted: true });
});

// POST /:id/contract/:cid/ticket  (multipart: status, optional file)  -> set the flight ticket on a contract
router.post("/:id/contract/:cid/ticket", ticketUpload.single("file"), async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const status = req.body.status === "taken" ? "taken" : "available";
  const f = req.file;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(f
      ? "UPDATE contracts SET ticket_status=$1, ticket_file=$2, ticket_name=$3 WHERE id=$4 AND employee_id=$5 RETURNING start_date, end_date"
      : "UPDATE contracts SET ticket_status=$1 WHERE id=$2 AND employee_id=$3 RETURNING start_date, end_date",
    f ? [status, f.buffer, f.originalname, req.params.cid, req.params.id] : [status, req.params.cid, req.params.id]);
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Contract not found" }); }
    if (f) {
      const ct = updated.rows[0];
      const label = `Flight ticket · ${d10(ct.start_date)} → ${d10(ct.end_date) || "ongoing"}`;
      await client.query(`INSERT INTO employee_documents (employee_id, contract_ticket_id, label, filename, mime, bytes, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (contract_ticket_id) DO UPDATE SET label=$3, filename=$4, mime=$5, bytes=$6, uploaded_by=$7, uploaded_at=now()`,
      [req.params.id, req.params.cid, label, f.originalname, f.mimetype, f.buffer, req.user.name]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, status });
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
});
router.get("/:id/contract/:cid/ticket", async (req, res) => {
  const t = (await query("SELECT ticket_file AS f, ticket_name AS n FROM contracts WHERE id=$1 AND employee_id=$2", [req.params.cid, req.params.id])).rows[0];
  if (!t || !t.f) return res.status(404).json({ error: "No ticket on file" });
  res.setHeader("Content-Disposition", `inline; filename="${(t.n || "ticket").replace(/[^\w.\-]/g, "_")}"`);
  res.send(t.f);
});

// POST /:id/contract/new  { startDate, endDate }  -> close current (snapshot unused), open a new one (resets vacation)
router.post("/:id/contract/new", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const { startDate, endDate } = req.body || {};
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) return res.status(400).json({ error: "Enter a valid start and end date in order" });
  const { currentContract } = require("../contracts");
  await currentContract(req.params.id);
  const entitlement = await defaultLeaveDays();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query("SELECT * FROM contracts WHERE employee_id=$1 AND is_current=true ORDER BY id DESC LIMIT 1 FOR UPDATE", [req.params.id])).rows[0];
    if (!cur || startDate <= d10(cur.start_date)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "New contract must start after the current contract" }); }
    const hasEarlier = (await client.query("SELECT EXISTS(SELECT 1 FROM contracts WHERE employee_id=$1 AND id<>$2) AS yes", [req.params.id, cur.id])).rows[0].yes;
    const cutoff = hasEarlier ? cur.created_at : null;
    const leaves = (await client.query("SELECT * FROM employee_leaves WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2)", [req.params.id, cutoff])).rows;
    const bonus = Number((await client.query("SELECT COALESCE(SUM(days),0) AS days FROM leave_compensations WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2)", [req.params.id, cutoff])).rows[0].days);
    const sum = leavesSummary(leaves, entitlement, bonus);
    await client.query("UPDATE contracts SET is_current=false, closed_at=now(), snapshot_entitlement=$2, snapshot_taken=$3, snapshot_unused=$4 WHERE id=$1",
      [cur.id, sum.entitlement, sum.taken + sum.planned, sum.remaining]);
    const ins = await client.query("INSERT INTO contracts (employee_id, start_date, end_date, is_current) VALUES ($1,$2,$3,true) RETURNING id", [req.params.id, startDate, endDate]);
    await client.query(`INSERT INTO employee_profiles (employee_id, contract_start, contract_expiry) VALUES ($1,$2,$3)
      ON CONFLICT (employee_id) DO UPDATE SET contract_start=$2, contract_expiry=$3, updated_at=now()`, [req.params.id, startDate, endDate]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'contract',$2,$3)",
      [req.params.id, `New contract ${startDate} to ${endDate}; previous had ${sum.remaining} unused day(s)`, req.user.name]);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, contractId: ins.rows[0].id, previousUnused: sum.remaining });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
});

// POST /:id/contract/:cid/settle  { used?, reimbursed?, note? }  -> draw down a closed contract's unused pool
router.post("/:id/contract/:cid/settle", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const used = Number(req.body.used || 0);
  const reimbursed = Number(req.body.reimbursed || 0);
  if (!Number.isFinite(used) || !Number.isFinite(reimbursed) || used < 0 || reimbursed < 0 || used + reimbursed === 0) return res.status(400).json({ error: "Enter days to use or reimburse" });
  const startDate = used ? req.body.startDate : null;
  const endDate = used ? req.body.endDate : null;
  if (used && (!validDate(startDate) || !validDate(endDate) || endDate < startDate)) return res.status(400).json({ error: "Enter the vacation start and end date" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(`UPDATE contracts SET settled_used=settled_used+$3, settled_reimbursed=settled_reimbursed+$4
      WHERE id=$1 AND employee_id=$2 AND is_current=false AND snapshot_unused - settled_used - settled_reimbursed >= $5 RETURNING id`,
      [req.params.cid, req.params.id, used, reimbursed, used + reimbursed]);
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Closed contract not found or insufficient unused days" }); }
    await client.query("INSERT INTO contract_settlements (contract_id, kind, days, start_date, end_date, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [req.params.cid, used ? "used" : "reimbursed", used || reimbursed, startDate, endDate, req.user.name]);
    await client.query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'leave',$2,$3)",
      [req.params.id, `Old contract: ${used ? `vacation ${used} day(s) ${startDate} to ${endDate}` : `reimbursed ${reimbursed} day(s)`}`, req.user.name]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
});

// POST /:id/leaves
router.post("/:id/leaves", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  const { startDate, endDate, days, type, status, notes } = req.body || {};
  if (!days || days <= 0) return res.status(400).json({ error: "Days is required" });
  const r = await query(
    "INSERT INTO employee_leaves (employee_id, start_date, end_date, days, type, status, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [req.params.id, startDate || null, endDate || null, parseInt(days, 10), type || "Annual", status || "Planned", notes || null, req.user.name]
  );
  res.status(201).json({ id: r.rows[0].id });
});

// DELETE /:id/leaves/:leaveId
router.delete("/:id/leaves/:leaveId", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "No access" });
  await query("DELETE FROM employee_leaves WHERE id=$1 AND employee_id=$2", [req.params.leaveId, req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
