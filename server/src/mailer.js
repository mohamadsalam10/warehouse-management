let cached; // undefined = not resolved, false = unavailable, object = transporter
function transport() {
  if (cached !== undefined) return cached;
  try {
    if (process.env.SMTP_URL) { const nodemailer = require("nodemailer"); cached = nodemailer.createTransport(process.env.SMTP_URL); }
    else cached = false;
  } catch (e) { console.error("Mailer init failed:", e.message); cached = false; }
  return cached;
}
async function sendMail({ to, subject, html, text }) {
  const t = transport();
  if (!t) { console.log(`[mailer] suppressed (set SMTP_URL to enable). to=${to} subject="${subject}"`); return { sent: false }; }
  try { await t.sendMail({ from: process.env.MAIL_FROM || "storage.ae <no-reply@storage.ae>", to, subject, html, text: text || "" }); return { sent: true }; }
  catch (e) { console.error("sendMail error:", e.message); return { sent: false, error: e.message }; }
}
module.exports = { sendMail };
