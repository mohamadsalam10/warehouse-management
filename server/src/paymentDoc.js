const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const ORANGE = rgb(0xfe / 255, 0x50 / 255, 0x00 / 255);
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.42, 0.42, 0.42);
const money = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(Number(n || 0));
const fmtDT = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

async function generateSignedPayment(p) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const sig = await doc.embedFont(StandardFonts.HelveticaOblique);
  const M = 56; let y = height - M;
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: ORANGE });
  page.drawText("storage.ae", { x: M, y, size: 20, font: bold, color: INK }); y -= 14;
  page.drawText("Final settlement acknowledgement", { x: M, y, size: 11, font: reg, color: MUTED }); y -= 40;

  const line = (label, val) => { page.drawText(label, { x: M, y, size: 10, font: reg, color: MUTED }); page.drawText(String(val), { x: M + 150, y, size: 11, font: bold, color: INK }); y -= 22; };
  line("Reference", `PP-${String(p.id).padStart(5, "0")}`);
  line("Employee", p.name || "—");
  line("Position", p.position || "—");
  line("Days owed", p.days);
  line("Daily rate", `AED ${money(p.daily_rate)}`);
  line("Amount payable", `AED ${money(p.amount)}`);
  if (p.reason) line("Reason", p.reason);
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: rgb(0.9, 0.9, 0.9) }); y -= 30;

  page.drawText("This document confirms that both parties agree the above final settlement amount is", { x: M, y, size: 10, font: reg, color: INK }); y -= 16;
  page.drawText("correct and has been settled. Signed electronically by the parties below.", { x: M, y, size: 10, font: reg, color: INK }); y -= 40;

  const sigBlock = async (title, name, when, x, imgData) => {
    page.drawText(title, { x, y, size: 9, font: reg, color: MUTED });
    let drewImage = false;
    if (imgData && typeof imgData === "string" && imgData.startsWith("data:image/png")) {
      try {
        const bytes = Buffer.from(imgData.split(",")[1], "base64");
        const png = await doc.embedPng(bytes);
        const maxW = 180, maxH = 46;
        const scale = Math.min(maxW / png.width, maxH / png.height);
        const w = png.width * scale, h = png.height * scale;
        page.drawImage(png, { x, y: y - 8 - h, width: w, height: h });
        drewImage = true;
      } catch (e) { drewImage = false; }
    }
    if (!drewImage) page.drawText(name || "—", { x, y: y - 26, size: 18, font: sig, color: INK });
    page.drawLine({ start: { x, y: y - 54 }, end: { x: x + 200, y: y - 54 }, thickness: 0.8, color: rgb(0.8, 0.8, 0.8) });
    page.drawText(`${name || ""}  ·  signed ${fmtDT(when)}`.trim(), { x, y: y - 68, size: 8, font: reg, color: MUTED });
  };
  await sigBlock("EMPLOYEE (receiver)", p.employee_signature, p.employee_signed_at, M, p.employee_sig_img);
  await sigBlock("MANAGER (payer)", p.manager_signature, p.manager_signed_at, width / 2 + 10, p.manager_sig_img);

  page.drawText(`Generated ${fmtDT(new Date())} · storage.ae`, { x: M, y: 40, size: 8, font: reg, color: MUTED });
  return await doc.save();
}
module.exports = { generateSignedPayment };
