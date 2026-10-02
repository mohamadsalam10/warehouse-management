const express = require("express");
const { getSettings, setSetting, settlementTemplate, defaultLeaveDays, leaveNoticeDays, maxMoversOnLeave } = require("../settings");
const { requireAuth } = require("../auth");
const { isAdmin } = require("../config");

const router = express.Router();
router.use(requireAuth);

// GET /api/settings/respondio  -> config status (token never returned in full)
router.get("/respondio", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const s = await getSettings(["respondio_token", "respondio_channel_id", "respondio_manager_phone", "respondio_procurement_phone", "respondio_hr_phone"]);
  const tmpl = await settlementTemplate();
  res.json({
    tokenSet: !!(s.respondio_token || process.env.RESPOND_IO_TOKEN),
    channelId: s.respondio_channel_id || process.env.RESPOND_IO_CHANNEL_ID || "",
    managerPhone: s.respondio_manager_phone || process.env.RESPOND_IO_MANAGER_PHONE || "",
    procurementPhone: s.respondio_procurement_phone || process.env.RESPOND_IO_PROCUREMENT_PHONE || "",
    hrPhone: s.respondio_hr_phone || process.env.RESPOND_IO_HR_PHONE || "",
    templateName: tmpl.name,
    templateLang: tmpl.language,
  });
});

// PUT /api/settings/respondio  { token?, channelId?, managerPhone?, procurementPhone?, templateName?, templateLang? }
router.put("/respondio", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const { token, channelId, managerPhone, procurementPhone, hrPhone, templateName, templateLang } = req.body || {};
  if (token) await setSetting("respondio_token", token.trim());
  if (channelId !== undefined) await setSetting("respondio_channel_id", (channelId || "").trim());
  if (managerPhone !== undefined) await setSetting("respondio_manager_phone", (managerPhone || "").trim());
  if (procurementPhone !== undefined) await setSetting("respondio_procurement_phone", (procurementPhone || "").trim());
  if (hrPhone !== undefined) await setSetting("respondio_hr_phone", (hrPhone || "").trim());
  if (templateName !== undefined) await setSetting("respondio_template_name", (templateName || "").trim());
  if (templateLang !== undefined) await setSetting("respondio_template_lang", (templateLang || "").trim());
  res.json({ ok: true });
});
// GET /api/settings/general -> global config (leave days)
router.get("/general", async (req, res) => {
  res.json({ defaultLeaveDays: await defaultLeaveDays(), leaveNoticeDays: await leaveNoticeDays(), maxMoversOnLeave: await maxMoversOnLeave() });
});
// PUT /api/settings/general { defaultLeaveDays }
router.put("/general", async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Admin only" });
  const n = parseInt(req.body && req.body.defaultLeaveDays, 10);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "Enter a valid number of days" });
  await setSetting("default_leave_days", String(n));
  if (req.body.leaveNoticeDays !== undefined) { const x = parseInt(req.body.leaveNoticeDays, 10); if (Number.isFinite(x) && x >= 0) await setSetting("leave_notice_days", String(x)); }
  if (req.body.maxMoversOnLeave !== undefined) { const x = parseInt(req.body.maxMoversOnLeave, 10); if (Number.isFinite(x) && x >= 1) await setSetting("max_movers_on_leave", String(x)); }
  res.json({ ok: true, defaultLeaveDays: n, leaveNoticeDays: await leaveNoticeDays(), maxMoversOnLeave: await maxMoversOnLeave() });
});

module.exports = router;