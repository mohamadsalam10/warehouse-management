// Send WhatsApp messages via the respond.io Developer API (v2).
// Credentials come from the app's Setup (stored in the DB) or, as a fallback, env vars.
// Templates come from server/src/whatsappTemplates.js — no env needed for them.
const BASE = (process.env.RESPONDIO_BASE_URL || "https://api.respond.io/v2").replace(/\/$/, "");

async function sendWhatsApp({ phone, text, params, template, config }) {
  const token = (config && config.token) || process.env.RESPOND_IO_TOKEN;
  if (!token) { console.log(`[respond.io] suppressed (no API token configured in Setup). to=${phone}`); return { sent: false, suppressed: true }; }
  if (!phone) return { sent: false, error: "No phone number" };
  const rawChannel = (config && config.channelId) || process.env.RESPOND_IO_CHANNEL_ID;
  const channelId = rawChannel ? Number(rawChannel) : undefined;
  let message;
  if (template && template.name) {
    const bodyParams = (params && params.length ? params : [text]).map((v) => ({ type: "text", text: String(v) }));
    message = { type: "whatsapp_template", template: { name: template.name, languageCode: template.language || "en", components: [{ type: "body", parameters: bodyParams }] } };
  } else {
    message = { type: "text", text };
  }
  const payload = channelId ? { channelId, message } : { message };
  const identifier = "phone:" + String(phone).trim();
  try {
    const res = await fetch(`${BASE}/contact/${encodeURIComponent(identifier)}/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("respond.io send failed", res.status, t.slice(0, 300));
      let detail = t; try { const j = JSON.parse(t); detail = j.message || j.error || t; } catch {}
      return { sent: false, error: `${res.status} ${String(detail).slice(0, 140)}`.trim() };
    }
    return { sent: true };
  } catch (e) { console.error("respond.io error", e.message); return { sent: false, error: e.message }; }
}
module.exports = { sendWhatsApp };
