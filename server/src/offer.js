const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const ORANGE = rgb(0xfe / 255, 0x50 / 255, 0x00 / 255);
const INK = rgb(0x0a / 255, 0x0a / 255, 0x0a / 255);
const MUTED = rgb(0.42, 0.42, 0.42);

const money = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "to be confirmed");

// Wrap text to a max width for the given font/size.
function wrap(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function generateOfferLetter(c) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const M = 56;

  // Orange header band with wordmark
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: ORANGE });
  page.drawText("storage.ae", { x: M, y: height - 60, size: 26, font: bold, color: rgb(1, 1, 1) });
  page.drawText("People Operations", { x: M, y: height - 80, size: 10, font: reg, color: rgb(1, 1, 1) });

  let y = height - 140;
  page.drawText("Offer of employment", { x: M, y, size: 20, font: bold, color: INK });
  y -= 18;
  page.drawText(fmtDate(new Date()), { x: M, y, size: 10, font: reg, color: MUTED });
  y -= 34;

  page.drawText(`Dear ${c.name},`, { x: M, y, size: 12, font: bold, color: INK });
  y -= 24;

  const intro = `We are pleased to offer you the position of ${c.job_role} at storage.ae in ${c.city}, ${c.country}. This letter sets out the main terms of your employment.`;
  for (const ln of wrap(intro, reg, 11, width - M * 2)) { page.drawText(ln, { x: M, y, size: 11, font: reg, color: INK }); y -= 16; }
  y -= 12;

  const rows = [
    ["Position", c.job_role],
    ["Location", `${c.warehouse && c.warehouse !== "-" ? c.warehouse + ", " : ""}${c.city}, ${c.country}`],
    ["Monthly salary", c.salary ? `AED ${money(c.salary)}` : "to be confirmed"],
    ["Start date", fmtDate(c.start_date)],
    ["Reference", c.code],
  ];
  for (const [k, v] of rows) {
    page.drawText(k, { x: M, y, size: 11, font: bold, color: INK });
    page.drawText(String(v), { x: M + 130, y, size: 11, font: reg, color: INK });
    y -= 20;
  }
  y -= 10;

  const body = "This offer is subject to the successful completion of documentation and onboarding. Please sign and return a copy to confirm your acceptance. We look forward to welcoming you to the team.";
  for (const ln of wrap(body, reg, 11, width - M * 2)) { page.drawText(ln, { x: M, y, size: 11, font: reg, color: INK }); y -= 16; }
  y -= 40;

  page.drawText("For and on behalf of storage.ae", { x: M, y, size: 11, font: reg, color: INK }); y -= 40;
  page.drawLine({ start: { x: M, y }, end: { x: M + 200, y }, thickness: 0.75, color: MUTED });
  page.drawText("Authorised signatory", { x: M, y: y - 14, size: 9, font: reg, color: MUTED });
  page.drawLine({ start: { x: width - M - 200, y }, end: { x: width - M, y }, thickness: 0.75, color: MUTED });
  page.drawText("Candidate signature", { x: width - M - 200, y: y - 14, size: 9, font: reg, color: MUTED });

  // Footer
  page.drawText("storage.ae  ·  Al Quoz, Dubai  ·  UAE trade licence 586077  ·  +971 4 807 3000", { x: M, y: 40, size: 8, font: reg, color: MUTED });

  return Buffer.from(await doc.save());
}

module.exports = { generateOfferLetter };
