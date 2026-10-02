const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const ORANGE = rgb(0xfe / 255, 0x50 / 255, 0);
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.88, 0.88, 0.88);
const WHITE = rgb(1, 1, 1);
const money = (n) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
let LOGO_BYTES = null;
try { LOGO_BYTES = fs.readFileSync(path.join(__dirname, "assets", "logo.png")); } catch (e) { LOGO_BYTES = null; }

// { name, position, month, base, additions:[{name,amount}], deductions:[{name,amount}], net }
async function generatePayslip(p) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const M = 56;

  // Dark header band with the logo (white logo needs a dark background)
  const bandH = 66;
  page.drawRectangle({ x: 0, y: height - bandH, width, height: bandH, color: INK });
  if (LOGO_BYTES) {
    try {
      const logo = await doc.embedPng(LOGO_BYTES);
      const lh = 26, lw = (logo.width / logo.height) * lh;
      page.drawImage(logo, { x: M, y: height - bandH + (bandH - lh) / 2, width: lw, height: lh });
    } catch (e) { page.drawText("storage.ae", { x: M, y: height - bandH + 24, size: 20, font: bold, color: WHITE }); }
  } else { page.drawText("storage.ae", { x: M, y: height - bandH + 24, size: 20, font: bold, color: WHITE }); }
  page.drawText("PAYSLIP", { x: width - M - bold.widthOfTextAtSize("PAYSLIP", 13), y: height - bandH + 26, size: 13, font: bold, color: ORANGE });

  let y = height - bandH - 34;
  page.drawText(p.name || "", { x: M, y, size: 15, font: bold, color: INK });
  page.drawText(p.position || "", { x: M, y: y - 16, size: 10, font: reg, color: MUTED });
  const ppLabel = "Pay period", ppVal = p.month || "";
  page.drawText(ppLabel, { x: width - M - reg.widthOfTextAtSize(ppLabel, 9), y, size: 9, font: reg, color: MUTED });
  page.drawText(ppVal, { x: width - M - bold.widthOfTextAtSize(ppVal, 13), y: y - 15, size: 13, font: bold, color: INK });
  y -= 50;

  const row = (label, amount, o = {}) => {
    page.drawText(label, { x: M, y, size: o.size || 11, font: o.bold ? bold : reg, color: o.color || INK });
    const a = "AED " + money(amount);
    page.drawText(a, { x: width - M - (o.bold ? bold : reg).widthOfTextAtSize(a, o.size || 11), y, size: o.size || 11, font: o.bold ? bold : reg, color: o.color || INK });
    y -= o.gap || 20;
  };
  const sect = (t) => { page.drawText(t.toUpperCase(), { x: M, y, size: 9, font: bold, color: ORANGE, opacity: 1 }); y -= 16; };
  const rule = () => { page.drawLine({ start: { x: M, y: y + 6 }, end: { x: width - M, y: y + 6 }, thickness: 0.6, color: LINE }); y -= 6; };

  const additions = p.additions || [], deductions = p.deductions || [];
  const base = Number(p.base) || 0;
  sect("Earnings");
  row("Salary", base);
  additions.forEach((a) => row(a.name, a.amount));
  const totAdd = additions.reduce((s, a) => s + Number(a.amount || 0), 0);
  rule(); row("Total earnings", base + totAdd, { bold: true }); y -= 14;

  sect("Deductions");
  if (deductions.length) deductions.forEach((d) => row(d.name, d.amount));
  else { page.drawText("None", { x: M, y, size: 11, font: reg, color: MUTED }); y -= 20; }
  const totDed = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
  rule(); row("Total deductions", totDed, { bold: true }); y -= 20;

  page.drawRectangle({ x: M, y: y - 8, width: width - 2 * M, height: 36, color: rgb(0.96, 0.96, 0.96) });
  page.drawText("NET PAY", { x: M + 14, y: y + 6, size: 12, font: bold, color: INK });
  const na = "AED " + money(p.net);
  page.drawText(na, { x: width - M - 14 - bold.widthOfTextAtSize(na, 15), y: y + 5, size: 15, font: bold, color: ORANGE });

  page.drawText("Thank you for your hard work.", { x: M, y: M, size: 9, font: bold, color: ORANGE });
  return await doc.save();
}
module.exports = { generatePayslip };
