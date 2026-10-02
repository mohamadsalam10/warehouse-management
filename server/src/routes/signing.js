// Public, login-free signing of pending-payment settlements via emailed token links.
const express = require("express");
const multer = require("multer");
const { query } = require("../db");
const { generateSignedPayment } = require("../paymentDoc");
const { notifyTemplate, notifyCollectionSubmitted, logDispatch } = require("../notify");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(Number(n || 0));

async function findByToken(token) {
  const r = await query("SELECT * FROM pending_payments WHERE employee_token=$1 OR manager_token=$1", [token]);
  const p = r.rows[0];
  if (!p) return null;
  const party = p.employee_token === token ? "employee" : "manager";
  return { p, party };
}

function pageShell(title, inner, subtitle) {
  const sub = subtitle || title;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--orange:#fe5000;--ink:#0a0a0a;--muted:#6b6b6b;--line:rgba(10,10,10,.12);--bg:#fafafa}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:520px;margin:0 auto;padding:24px 18px 60px}
.bar{height:6px;background:var(--orange);border-radius:6px;margin-bottom:18px}
.brand{font-weight:800;font-size:20px;margin-bottom:2px}.sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}.row:last-child{border-bottom:none}
.row .k{color:var(--muted)}.row .v{font-weight:600}
h1{font-size:18px;margin:0 0 4px}label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:14px 0 6px}
input[type=text]{width:100%;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:16px;font-family:inherit}
.consent{display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--ink);margin-top:14px}
button{width:100%;margin-top:18px;background:var(--orange);color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}
.sigwrap{border:1px dashed var(--line);border-radius:10px;background:#fff;overflow:hidden}
.sigpad{width:100%;height:150px;display:block;touch-action:none;cursor:crosshair}
.sigclear{width:auto;margin-top:8px;background:none;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600}
.ok{background:#eafaf0;border:1px solid #bfe6cf;color:#1f8a4d;border-radius:10px;padding:14px;font-weight:600}
.warn{background:#fff4e5;border:1px solid #ffd9a8;color:#b26a00;border-radius:10px;padding:12px;font-size:13px}
.err{background:#fdecea;border:1px solid #f5c2bd;color:#c0362c;border-radius:10px;padding:12px;font-size:13px;margin-top:12px;display:none}
.dl{display:inline-block;margin-top:14px;color:var(--orange);font-weight:600;text-decoration:none}
.foot{color:var(--muted);font-size:11px;text-align:center;margin-top:24px}
</style></head><body><div class="wrap"><div class="bar"></div><div class="brand">storage.ae</div><div class="sub">${esc(sub)}</div>${inner}<div class="foot">This link was sent to you by storage.ae. Do not share it.</div></div></body></html>`;
}

function detailsCard(p) {
  return `<div class="card">
    <div class="row"><span class="k">Reference</span><span class="v">PP-${String(p.id).padStart(5, "0")}</span></div>
    <div class="row"><span class="k">Employee</span><span class="v">${esc(p.name)}</span></div>
    <div class="row"><span class="k">Days owed</span><span class="v">${esc(p.days)}</span></div>
    <div class="row"><span class="k">Daily rate</span><span class="v">AED ${money(p.daily_rate)}</span></div>
    <div class="row"><span class="k">Amount payable</span><span class="v">AED ${money(p.amount)}</span></div>
    ${p.reason ? `<div class="row"><span class="k">Reason</span><span class="v">${esc(p.reason)}</span></div>` : ""}
  </div>`;
}

// GET /sign/:token  -> the signing page
router.get("/sign/:token", async (req, res) => {
  const found = await findByToken(req.params.token);
  if (!found) return res.status(404).send(pageShell("Not found", `<div class="warn">This signing link is not valid.</div>`));
  const { p, party } = found;
  const already = party === "employee" ? p.employee_signed_at : p.manager_signed_at;
  const bothDone = p.status === "paid";
  const role = party === "employee" ? "receiver (employee)" : "payer (manager)";
  let inner = detailsCard(p);
  if (bothDone) {
    inner += `<div class="ok">This settlement has been fully signed and completed.</div><a class="dl" href="/sign/${req.params.token}/document.pdf">Download the signed PDF</a>`;
  } else if (already) {
    inner += `<div class="ok">You have already signed as the ${esc(role)}.</div><div class="warn" style="margin-top:12px">Waiting for the other party to sign.</div>`;
  } else {
    inner += `<div class="card"><h1>Sign as the ${esc(role)}</h1>
      <p style="font-size:13px;color:var(--muted)">Type your full name and draw your signature below.</p>
      <label>Full name</label><input id="name" type="text" autocomplete="name" placeholder="Your full name"/>
      <label>Signature</label>
      <div class="sigwrap"><canvas id="pad" class="sigpad"></canvas></div>
      <button type="button" class="sigclear" onclick="clearPad()">Clear signature</button>
      <div class="consent"><input id="consent" type="checkbox"/><span>I confirm the amount above is correct and I agree to sign this settlement electronically.</span></div>
      <button id="btn" onclick="submitSig()">Sign now</button>
      <div class="err" id="err"></div></div>
      <script>
      var canvas=document.getElementById('pad'), ctx=canvas.getContext('2d'), drawing=false, hasInk=false;
      function fit(){ var r=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1; canvas.width=r.width*dpr; canvas.height=r.height*dpr; ctx.scale(dpr,dpr); ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.strokeStyle='#0a0a0a'; }
      fit();
      function pos(e){ var r=canvas.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return {x:t.clientX-r.left,y:t.clientY-r.top}; }
      function start(e){ drawing=true; var p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); }
      function move(e){ if(!drawing)return; var p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasInk=true; e.preventDefault(); }
      function end(){ drawing=false; }
      canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
      canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); canvas.addEventListener('touchend',end);
      function clearPad(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; }
      async function submitSig(){
        var name=document.getElementById('name').value.trim();
        var consent=document.getElementById('consent').checked;
        var err=document.getElementById('err');err.style.display='none';
        if(!name){err.textContent='Please enter your full name.';err.style.display='block';return;}
        if(!hasInk){err.textContent='Please draw your signature.';err.style.display='block';return;}
        if(!consent){err.textContent='Please tick the confirmation box.';err.style.display='block';return;}
        document.getElementById('btn').disabled=true;
        var img=canvas.toDataURL('image/png');
        try{
          var r=await fetch('/api/sign/${req.params.token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:name,signatureImage:img})});
          var d=await r.json();
          if(!r.ok){throw new Error(d.error||'Could not sign');}
          document.querySelector('.wrap').innerHTML='<div class="bar"></div><div class="brand">storage.ae</div><div class="sub">Final settlement signature</div><div class="ok">Thank you, your signature has been recorded.</div>'+(d.completed?'<div class="ok" style="margin-top:12px">Both parties have signed. The settlement is now complete.</div><a class="dl" href="/sign/${req.params.token}/document.pdf">Download the signed PDF</a>':'<div class="warn" style="margin-top:12px">Waiting for the other party to sign.</div>');
        }catch(e){err.textContent=e.message;err.style.display='block';document.getElementById('btn').disabled=false;}
      }
      </script>`;
  }
  res.send(pageShell("Sign settlement", inner, "Final settlement signature"));
});

// POST /api/sign/:token  { fullName }  -> record signature; finalize if both signed
router.post("/api/sign/:token", express.json(), async (req, res) => {
  const found = await findByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Invalid link" });
  const { p, party } = found;
  if (p.status === "paid") return res.json({ ok: true, completed: true });
  const name = (req.body.fullName || "").trim();
  if (!name) return res.status(400).json({ error: "Full name is required" });
  const sigImg = typeof req.body.signatureImage === "string" && req.body.signatureImage.startsWith("data:image/") ? req.body.signatureImage : null;
  const col = party === "employee" ? "employee" : "manager";
  const already = party === "employee" ? p.employee_signed_at : p.manager_signed_at;
  if (already) return res.json({ ok: true, completed: p.status === "paid" });
  await query(`UPDATE pending_payments SET ${col}_signature=$1, ${col}_sig_img=$2, ${col}_signed_at=now() WHERE id=$3`, [name, sigImg, p.id]);
  const fresh = (await query("SELECT * FROM pending_payments WHERE id=$1", [p.id])).rows[0];
  let completed = false;
  if (fresh.employee_signed_at && fresh.manager_signed_at) {
    const pdf = await generateSignedPayment(fresh);
    await query("UPDATE pending_payments SET status='paid', paid_at=now(), signed_pdf=$1 WHERE id=$2", [Buffer.from(pdf), p.id]);
    completed = true;
  }
  res.json({ ok: true, completed });
});

// GET /sign/:token/document.pdf  -> download the signed PDF (public, after completion)
router.get("/sign/:token/document.pdf", async (req, res) => {
  const found = await findByToken(req.params.token);
  if (!found || !found.p.signed_pdf) return res.status(404).send("Not available yet");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="settlement.pdf"`);
  res.send(found.p.signed_pdf);
});

// ---- Uniform sizes: public form the employee fills from a WhatsApp link ----
async function candByToken(token) {
  const r = await query("SELECT * FROM candidates WHERE sizes_token=$1", [token]);
  return r.rows[0] || null;
}

router.get("/sizes/:token", async (req, res) => {
  const c = await candByToken(req.params.token);
  if (!c) return res.status(404).send(pageShell("Not found", `<div class="warn">This link is not valid.</div>`));
  const done = c.collection_submitted_at;
  const inner = `<div class="card"><h1>Complete your details</h1>
    <p style="font-size:13px;color:var(--muted)">Hi ${esc(c.name)}, please share the following so we can prepare your onboarding.</p>
    <label>Passport copy</label><input id="passport" type="file" accept="image/*,application/pdf"/>
    <label>Digital studio photo</label><input id="photo" type="file" accept="image/*"/>
    <label>Current visa status</label><input id="visa" type="text" placeholder="e.g. Visit visa, Cancelled, Employment visa" value="${esc(c.visa_status || "")}"/>
    <label style="margin-top:10px">T-shirt size</label><input id="tshirt" type="text" placeholder="e.g. M, L, XL" value="${esc(c.tshirt_size || "")}"/>
    <label>Pants / trouser size</label><input id="pants" type="text" placeholder="e.g. 32, M" value="${esc(c.pants_size || "")}"/>
    <label>Shoe size</label><input id="shoe" type="text" placeholder="e.g. 42, UK 8" value="${esc(c.shoe_size || "")}"/>
    <button id="btn" onclick="submitAll()">Submit</button>
    <div class="err" id="err"></div>${done ? `<div class="warn" style="margin-top:12px">You have already submitted. You can resubmit to update.</div>` : ""}</div>
    <script>
    async function submitAll(){
      var err=document.getElementById('err');err.style.display='none';
      var p=document.getElementById('passport').files[0];
      var ph=document.getElementById('photo').files[0];
      var visa=document.getElementById('visa').value.trim();
      var tshirt=document.getElementById('tshirt').value.trim();
      var pants=document.getElementById('pants').value.trim();
      var shoe=document.getElementById('shoe').value.trim();
      var already=${done ? "true" : "false"};
      if(!visa||!tshirt||!pants||!shoe){err.textContent='Please fill in all the fields.';err.style.display='block';return;}
      if(!already&&(!p||!ph)){err.textContent='Please attach your passport copy and studio photo.';err.style.display='block';return;}
      var fd=new FormData();
      if(p) fd.append('passport',p);
      if(ph) fd.append('photo',ph);
      fd.append('visa',visa);fd.append('tshirt',tshirt);fd.append('pants',pants);fd.append('shoe',shoe);
      document.getElementById('btn').disabled=true;
      try{
        var r=await fetch('/api/sizes/${req.params.token}',{method:'POST',body:fd});
        var d=await r.json(); if(!r.ok){throw new Error(d.error||'Could not save');}
        document.querySelector('.wrap').innerHTML='<div class="bar"></div><div class="brand">storage.ae</div><div class="sub">Onboarding details</div><div class="ok">Thank you, your details have been submitted.</div>';
      }catch(e){err.textContent=e.message;err.style.display='block';document.getElementById('btn').disabled=false;}
    }
    </script>`;
  res.send(pageShell("Complete your details", inner));
});

router.post("/api/sizes/:token", upload.fields([{ name: "passport", maxCount: 1 }, { name: "photo", maxCount: 1 }]), async (req, res) => {
  const c = await candByToken(req.params.token);
  if (!c) return res.status(404).json({ error: "Invalid link" });
  const tshirt = (req.body.tshirt || "").trim() || null;
  const pants = (req.body.pants || "").trim() || null;
  const shoe = (req.body.shoe || "").trim() || null;
  const visa = (req.body.visa || "").trim() || null;
  const pass = req.files && req.files.passport && req.files.passport[0];
  const photo = req.files && req.files.photo && req.files.photo[0];
  if (!visa || !tshirt || !pants || !shoe) return res.status(400).json({ error: "Please fill in all the fields." });
  const firstTime = !c.collection_submitted_at;
  if (firstTime && (!pass || !photo)) return res.status(400).json({ error: "Please attach your passport copy and studio photo." });
  await query(
    `UPDATE candidates SET tshirt_size=$1, pants_size=$2, shoe_size=$3, visa_status=$4, collection_submitted_at=now()
     ${pass ? ", passport_file=$6, passport_name=$7" : ""} ${photo ? (pass ? ", photo_file=$8, photo_name=$9" : ", photo_file=$6, photo_name=$7") : ""}
     WHERE id=$5`,
    pass && photo ? [tshirt, pants, shoe, visa, c.id, pass.buffer, pass.originalname, photo.buffer, photo.originalname]
      : pass ? [tshirt, pants, shoe, visa, c.id, pass.buffer, pass.originalname]
      : photo ? [tshirt, pants, shoe, visa, c.id, photo.buffer, photo.originalname]
      : [tshirt, pants, shoe, visa, c.id]);
  const ord = (await query("SELECT id FROM procurement_orders WHERE employee_id=$1 AND auto=true ORDER BY id DESC LIMIT 1", [c.id])).rows[0];
  if (ord) {
    const items = (await query("SELECT id, item FROM procurement_order_items WHERE order_id=$1", [ord.id])).rows;
    for (const it of items) {
      const n = (it.item || "").toLowerCase();
      let size = null;
      if (n.includes("shirt") || n.includes("tee") || n.includes("polo")) size = tshirt;
      else if (n.includes("pant") || n.includes("trouser") || n.includes("bottom")) size = pants;
      else if (n.includes("shoe") || n.includes("boot") || n.includes("footwear")) size = shoe;
      if (size) await query("UPDATE procurement_order_items SET size=$1 WHERE id=$2", [size, it.id]);
    }
  }
  try { await logDispatch(c.id, "HR/manager collection-submitted alert", notifyCollectionSubmitted({ name: c.name, job_role: c.job_role })); } catch (e) {}
  res.json({ ok: true });
});

// ---- Self-service interview booking (public, no login) ----
async function candByBooking(token) {
  const r = await query("SELECT * FROM candidates WHERE booking_token=$1", [token]);
  return r.rows[0] || null;
}
async function openSlots(cand) {
  const r = await query(
    `SELECT s.id, s.slot_date, s.slot_time, cal.name AS cal_name
     FROM interview_slots s JOIN calendars cal ON cal.id = s.calendar_id
     WHERE s.candidate_id IS NULL ORDER BY s.slot_date, s.slot_time`);
  // Only from tomorrow onwards (Dubai date) — never today, even if time remains.
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  return r.rows.filter((s) => new Date(s.slot_date).toISOString().slice(0, 10) > todayStr);
}

router.get("/book/:token", async (req, res) => {
  const c = await candByBooking(req.params.token);
  if (!c) return res.status(404).send(pageShell("Not found", `<div class="warn">This link is not valid.</div>`));
  if (c.stage !== "Pending interview" && c.stage !== "Shortlisted") {
    return res.send(pageShell("Interview booked", `<div class="ok">Your interview is already booked. See you then.</div>`));
  }
  const slots = await openSlots(c);
  if (!slots.length) return res.send(pageShell("Book your interview", `<div class="card"><h1>Book your interview</h1><p style="font-size:13px;color:var(--muted)">Hi ${esc(c.name)}, there are no available times right now. We'll be in touch shortly.</p></div>`));
  const byDate = {};
  slots.forEach((s) => { const d = new Date(s.slot_date).toISOString().slice(0, 10); (byDate[d] ||= []).push(s); });
  const groups = Object.keys(byDate).map((d) => {
    const label = new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const btns = byDate[d].map((s) => `<button class="slotbtn" onclick="book(${s.id},this)">${String(s.slot_time).slice(0, 5)}</button>`).join("");
    return `<div class="daygrp"><div class="daylbl">${label}</div><div class="slots">${btns}</div></div>`;
  }).join("");
  const inner = `<div class="card"><h1>Book your interview</h1>
    <p style="font-size:13px;color:var(--muted)">Hi ${esc(c.name)}, pick a time that suits you for your ${esc(c.job_role)} interview.</p>
    ${groups}<div class="err" id="err"></div></div>
    <style>.daygrp{margin:14px 0}.daylbl{font-weight:600;font-size:13px;margin-bottom:6px}.slots{display:flex;flex-wrap:wrap;gap:8px}.slotbtn{width:auto;margin:0;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:15px;cursor:pointer}.slotbtn:hover{border-color:var(--orange)}</style>
    <script>
    async function book(id,el){
      var err=document.getElementById('err');err.style.display='none';
      document.querySelectorAll('.slotbtn').forEach(function(b){b.disabled=true});
      try{
        var r=await fetch('/api/book/${req.params.token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slotId:id})});
        var d=await r.json(); if(!r.ok){throw new Error(d.error||'Could not book');}
        document.querySelector('.wrap').innerHTML='<div class="bar"></div><div class="brand">storage.ae</div><div class="sub">Interview</div><div class="ok">Your interview is booked for '+d.when+'. See you then.</div>';
      }catch(e){err.textContent=e.message;err.style.display='block';document.querySelectorAll('.slotbtn').forEach(function(b){b.disabled=false});}
    }
    </script>`;
  res.send(pageShell("Book your interview", inner));
});

router.post("/api/book/:token", express.json(), async (req, res) => {
  const c = await candByBooking(req.params.token);
  if (!c) return res.status(404).json({ error: "Invalid link" });
  const slotId = req.body && req.body.slotId;
  const slot = (await query("SELECT * FROM interview_slots WHERE id=$1", [slotId])).rows[0];
  if (!slot) return res.status(404).json({ error: "That time is no longer available" });
  if (slot.candidate_id) return res.status(409).json({ error: "That time was just taken. Please pick another." });
  const dt = new Date(`${new Date(slot.slot_date).toISOString().slice(0, 10)}T${String(slot.slot_time).slice(0, 5)}:00`);
  if (dt.getTime() < Date.now()) return res.status(400).json({ error: "That time is in the past" });
  await query("UPDATE interview_slots SET candidate_id=$1 WHERE id=$2 AND candidate_id IS NULL", [c.id, slotId]);
  await query("UPDATE candidates SET phase='Recruitment', stage='Interview', stage_since=now() WHERE id=$1", [c.id]);
  await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'stage',$2,'Self-booked')", [c.id, `Interview self-booked for ${new Date(slot.slot_date).toISOString().slice(0, 10)} ${String(slot.slot_time).slice(0, 5)}`]);
  // send the same interview templates HR would send
  try {
    const cal = (await query("SELECT cal.phone AS cal_phone, u.name AS owner FROM calendars cal JOIN users u ON u.id=cal.user_id WHERE cal.id=$1", [slot.calendar_id])).rows[0] || {};
    const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const fmtTime = (t) => String(t).slice(0, 5);
    const templates = require("../whatsappTemplates");
    notifyTemplate({ phone: c.phone, template: templates.interviewCandidate, params: [c.name, c.job_role, fmtDate(slot.slot_date), fmtTime(slot.slot_time)] });
    if (cal.cal_phone) notifyTemplate({ phone: cal.cal_phone, template: templates.interviewInterviewer, params: [cal.owner || "there", c.name, c.job_role, fmtDate(slot.slot_date), fmtTime(slot.slot_time)] });
  } catch (e) { console.error("booking notify failed", e.message); }
  res.json({ ok: true, when: `${new Date(slot.slot_date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} at ${String(slot.slot_time).slice(0, 5)}` });
});

// GET /payslip/:token -> serve the payslip PDF (public, login-free)
router.get("/payslip/:token", async (req, res) => {
  const d = (await query("SELECT bytes, filename FROM employee_documents WHERE share_token=$1 AND label ILIKE 'Payslip%'", [req.params.token])).rows[0];
  if (!d || !d.bytes) return res.status(404).send(pageShell("Not found", `<div class="warn">This payslip link is not valid.</div>`));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${(d.filename || "payslip.pdf").replace(/[^\w.\-]/g, "_")}"`);
  res.send(d.bytes);
});

module.exports = router;
