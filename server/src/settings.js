const { query } = require("./db");

async function getSettings(keys) {
  const r = await query("SELECT key, value FROM app_settings WHERE key = ANY($1)", [keys]);
  const m = {}; r.rows.forEach((x) => (m[x.key] = x.value)); return m;
}
async function setSetting(key, value) {
  await query("INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [key, value]);
}
// respond.io credentials: DB settings first, then env vars as a fallback.
async function respondConfig() {
  const s = await getSettings(["respondio_token", "respondio_channel_id", "respondio_manager_phone", "respondio_procurement_phone", "respondio_hr_phone"]);
  return {
    token: s.respondio_token || process.env.RESPOND_IO_TOKEN || null,
    channelId: s.respondio_channel_id || process.env.RESPOND_IO_CHANNEL_ID || null,
    managerPhone: s.respondio_manager_phone || process.env.RESPOND_IO_MANAGER_PHONE || null,
    procurementPhone: s.respondio_procurement_phone || process.env.RESPOND_IO_PROCUREMENT_PHONE || null,
    hrPhone: s.respondio_hr_phone || process.env.RESPOND_IO_HR_PHONE || null,
  };
}
// Effective settlement template: Setup override (DB) wins over the code registry default.
async function settlementTemplate() {
  const reg = require("./whatsappTemplates").settlement;
  const s = await getSettings(["respondio_template_name", "respondio_template_lang"]);
  return { name: s.respondio_template_name || reg.name, language: s.respondio_template_lang || reg.language };
}
module.exports = { getSettings, setSetting, respondConfig, settlementTemplate, defaultLeaveDays, leaveNoticeDays, maxMoversOnLeave };

async function leaveNoticeDays() {
  const s = await getSettings(["leave_notice_days"]);
  const n = parseInt(s.leave_notice_days, 10);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}
async function maxMoversOnLeave() {
  const s = await getSettings(["max_movers_on_leave"]);
  const n = parseInt(s.max_movers_on_leave, 10);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

// Global annual leave entitlement for all employees (set in Setup). Defaults to 30.
async function defaultLeaveDays() {
  const s = await getSettings(["default_leave_days"]);
  const n = parseInt(s.default_leave_days, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
