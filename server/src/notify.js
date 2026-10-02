// Best-effort WhatsApp notifications for lifecycle events (via respond.io).
const crypto = require("crypto");
const { sendWhatsApp } = require("./respondio");
const { respondConfig } = require("./settings");
const { query } = require("./db");

// Sends a template message. Never throws — returns a delivery result and logs failures.
async function notifyTemplate({ phone, template, params, text }) {
  try {
    if (!phone) return { sent: false, error: "no phone" };
    if (params.some((p) => p === null || p === undefined || String(p).trim() === "")) return { sent: false, error: "missing template values" };
    const cfg = await respondConfig();
    return await sendWhatsApp({ phone, text: text || params.join(" "), params, template, config: cfg });
  } catch (e) { console.error("notifyTemplate error", e.message); return { sent: false, error: e.message }; }
}

// Ensures the candidate has a sizes token and sends them the uniform-sizes form link.
async function sendSizesRequest(cand, baseUrl) {
  try {
    if (!cand || !cand.phone) return { sent: false, error: "no phone" };
    let token = cand.sizes_token;
    if (!token) { token = crypto.randomBytes(20).toString("hex"); await query("UPDATE candidates SET sizes_token=$1 WHERE id=$2", [token, cand.id]); }
    const base = (baseUrl || process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const link = `${base}/sizes/${token}`;
    const templates = require("./whatsappTemplates");
    const d = await notifyTemplate({ phone: cand.phone, template: templates.uniformSizes, params: [cand.name, link],
      text: `Hi ${cand.name}, please share your uniform sizes so we can prepare your kit. Open your form here: ${link} and complete it. Thank you.` });
    return { ...d, link };
  } catch (e) { console.error("sendSizesRequest error", e.message); return { sent: false, error: e.message }; }
}
// Sends the documents-collection request to the candidate (passport, photo, visa status, sizes link).
async function sendCollectionRequest(cand, baseUrl) {
  try {
    if (!cand || !cand.phone) return { sent: false, error: "no phone" };
    let token = cand.sizes_token;
    if (!token) { token = crypto.randomBytes(20).toString("hex"); await query("UPDATE candidates SET sizes_token=$1 WHERE id=$2", [token, cand.id]); }
    const base = (baseUrl || process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const link = `${base}/sizes/${token}`;
    const templates = require("./whatsappTemplates");
    const d = await notifyTemplate({ phone: cand.phone, template: templates.documentsCollection, params: [cand.name, link],
      text: `Hi ${cand.name}, welcome to storage.ae. To start your onboarding please reply with your passport copy, a digital studio photo, and your current visa status. Also share your uniform sizes here: ${link} so we can prepare your kit. Thank you.` });
    return { ...d, link };
  } catch (e) { console.error("sendCollectionRequest error", e.message); return { sent: false, error: e.message }; }
}

// Tells the manager (settlement manager number) a candidate is ready for Medical & Tawjeeh.
async function notifyMedicalManager(cand) {
  try {
    const cfg = await respondConfig();
    if (!cfg.managerPhone) return { sent: false, error: "no manager number set in Setup" };
    const templates = require("./whatsappTemplates");
    return await notifyTemplate({ phone: cfg.managerPhone, template: templates.medicalTawjeeh, params: [cand.name, cand.job_role],
      text: `Hi, candidate ${cand.name} (${cand.job_role}) is now set for Medical and Tawjeeh. Please arrange for them to complete it upon availability. Thank you, storage.ae.` });
  } catch (e) { console.error("notifyMedicalManager error", e.message); return { sent: false, error: e.message }; }
}

// Tells the procurement manager a uniform work order was generated.
async function notifyProcurement(cand) {
  try {
    const cfg = await respondConfig();
    if (!cfg.procurementPhone) return { sent: false, error: "no procurement number set in Setup" };
    const templates = require("./whatsappTemplates");
    return await notifyTemplate({ phone: cfg.procurementPhone, template: templates.procurementOrder, params: [cand.name, cand.job_role],
      text: `Hi, a new uniform work order has been generated for ${cand.name} (${cand.job_role}). Please open the app to view and process it. Thank you, storage.ae.` });
  } catch (e) { console.error("notifyProcurement error", e.message); return { sent: false, error: e.message }; }
}
// Tells a staff member they've been assigned to run a training level for an employee.
async function notifyTrainingAssignee(assignee, stage, cand) {
  try {
    if (!assignee || !assignee.phone) return { sent: false, error: "assignee has no WhatsApp number" };
    const templates = require("./whatsappTemplates");
    return await notifyTemplate({ phone: assignee.phone, template: templates.trainingAssignment, params: [assignee.name, stage, cand.name, cand.job_role],
      text: `Hi ${assignee.name}, you have been assigned to run ${stage} training for ${cand.name} (${cand.job_role}). Please complete it and mark it done in the app. Thank you, storage.ae.` });
  } catch (e) { console.error("notifyTrainingAssignee error", e.message); return { sent: false, error: e.message }; }
}

// Sends an employee their monthly salary summary. additions/deductions are itemized strings.
async function sendSalaryBreakdown(cand, month, base, additionsStr, deductionsStr, net) {
  try {
    if (!cand || !cand.phone) return { sent: false, error: "no phone" };
    const templates = require("./whatsappTemplates");
    const f = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(Number(n || 0));
    const add = additionsStr || "none", ded = deductionsStr || "none";
    return await notifyTemplate({ phone: cand.phone, template: templates.salaryBreakdown,
      params: [cand.name, month, f(base), add, ded, f(net)],
      text: `Hi ${cand.name}, here is your salary summary for ${month}. Base: AED ${f(base)}. Additions: ${add}. Deductions: ${ded}. Net pay: AED ${f(net)}. Contact HR for any questions. storage.ae.` });
  } catch (e) { console.error("sendSalaryBreakdown error", e.message); return { sent: false, error: e.message }; }
}
// Ensures a booking token and sends the candidate the self-service interview booking link.
async function sendBookingLink(cand, baseUrl) {
  try {
    if (!cand || !cand.phone) return { sent: false, error: "no phone" };
    let token = cand.booking_token;
    if (!token) { token = crypto.randomBytes(20).toString("hex"); await query("UPDATE candidates SET booking_token=$1 WHERE id=$2", [token, cand.id]); }
    const base = (baseUrl || process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const link = `${base}/book/${token}`;
    const templates = require("./whatsappTemplates");
    const d = await notifyTemplate({ phone: cand.phone, template: templates.interviewBooking, params: [cand.name, cand.job_role, link],
      text: `Hi ${cand.name}, thank you for applying to storage.ae for the ${cand.job_role} role. Please pick an interview time here: ${link}. We look forward to meeting you.` });
    return { ...d, link };
  } catch (e) { console.error("sendBookingLink error", e.message); return { sent: false, error: e.message }; }
}
// Tells the manager/HR that a candidate has submitted their documents + sizes form.
async function notifyCollectionSubmitted(cand) {
  try {
    const cfg = await respondConfig();
    const to = cfg.hrPhone || cfg.managerPhone;
    if (!to) return { sent: false, error: "no HR number set in Setup" };
    const templates = require("./whatsappTemplates");
    return await notifyTemplate({ phone: to, template: templates.collectionSubmitted, params: [cand.name, cand.job_role],
      text: `Hi, candidate ${cand.name} (${cand.job_role}) has submitted their documents and sizes. Please review in the app. Thank you, storage.ae.` });
  } catch (e) { console.error("notifyCollectionSubmitted error", e.message); return { sent: false, error: e.message }; }
}
// Awaits a best-effort WhatsApp dispatch and records the outcome on the candidate's timeline
// (candidate_events), so a failed/suppressed send is visible in the app instead of only in the
// server console. Use this instead of firing a notify* call without awaiting/checking it.
async function logDispatch(candidateId, label, deliveryPromise) {
  try {
    const d = await deliveryPromise;
    if (d && d.sent) await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'notify',$2,'system')", [candidateId, `${label}: sent`]);
    else await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'notify-failed',$2,'system')", [candidateId, `${label}: not sent (${(d && d.error) || "unknown reason"})`]);
    return d;
  } catch (e) {
    try { await query("INSERT INTO candidate_events (candidate_id, type, detail, actor) VALUES ($1,'notify-failed',$2,'system')", [candidateId, `${label}: not sent (${e.message})`]); } catch {}
    return { sent: false, error: e.message };
  }
}

// Sends an employee a link to their payslip PDF.
async function sendPayslipLink(cand, month, link) {
  try {
    if (!cand || !cand.phone) return { sent: false, error: "no phone" };
    const templates = require("./whatsappTemplates");
    return await notifyTemplate({ phone: cand.phone, template: templates.payslipLink, params: [cand.name, month, link],
      text: `Hi ${cand.name}, your payslip for ${month} is ready. View it here: ${link}. Contact HR for any questions. storage.ae.` });
  } catch (e) { console.error("sendPayslipLink error", e.message); return { sent: false, error: e.message }; }
}

module.exports = { notifyTemplate, sendSizesRequest, sendCollectionRequest, notifyMedicalManager, notifyProcurement, notifyTrainingAssignee, sendSalaryBreakdown, sendBookingLink, notifyCollectionSubmitted, logDispatch, sendPayslipLink };
