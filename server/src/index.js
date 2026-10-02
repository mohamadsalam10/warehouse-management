require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

// Resilience: never let a single unhandled error take the whole service down.
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err && err.stack ? err.stack : err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err && err.stack ? err.stack : err));

const { migrate } = require("./migrate");
const { seed, seedConfig, backfill } = require("./seed");

const authRoutes = require("./routes/auth");
const metaRoutes = require("./routes/meta");
const candidateRoutes = require("./routes/candidates");
const kitRoutes = require("./routes/kit");
const configRoutes = require("./routes/config");
const userRoutes = require("./routes/users");
const accountingRoutes = require("./routes/accounting");
const calendarRoutes = require("./routes/calendars");
const profileRoutes = require("./routes/profile");
const expiryRoutes = require("./routes/expiry");
const procurementRoutes = require("./routes/procurement");
const portalRoutes = require("./routes/portal");
const requestRoutes = require("./routes/requests");
const signingRoutes = require("./routes/signing");
const settingsRoutes = require("./routes/settings");

const app = express();
app.use(cors());
app.use(express.json());

// ---- API ---------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/candidates", candidateRoutes);
app.use("/api/candidates", kitRoutes); // POST /api/candidates/:id/kit
app.use("/api/candidates", profileRoutes); // /:id/profile, /:id/leaves
app.use("/api/config", configRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", require("./routes/roles"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/accounting", accountingRoutes);
app.use("/api/calendars", calendarRoutes);
app.use("/api/expiry", expiryRoutes);
app.use("/api/procurement", procurementRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/requests", requestRoutes);
// Public, login-free signing pages and API (accessed via emailed token links)
app.use(signingRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/bot", require("./routes/bot"));

// ---- Serve the built client in production ------------------------------
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
const indexHtml = path.join(clientDist, "index.html");

// Log what we actually find, so the Render logs show the truth at boot.
console.log("Client dist path:", clientDist);
if (fs.existsSync(clientDist)) {
  console.log("dist contents:", fs.readdirSync(clientDist).join(", "));
  const assetsDir = path.join(clientDist, "assets");
  if (fs.existsSync(assetsDir)) console.log("dist/assets:", fs.readdirSync(assetsDir).join(", "));
  else console.log("WARNING: dist/assets is missing");
} else {
  console.log("WARNING: client/dist not found. The client build did not run or output elsewhere.");
}

// Serve the built files (Express sets correct MIME types for .css/.js).
app.use(express.static(clientDist));

// SPA fallback: only for navigation requests.
// - /api/* is left to the API (or 404s as an unknown API route)
// - a request for a real file with an extension that static did not find
//   returns a true 404, never index.html (which would cause MIME errors)
// - everything else returns index.html so client-side routing works
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  if (path.extname(req.path)) return res.status(404).send("Not found");
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
  return res.status(500).send("Client build not found. Check that the build step ran.");
});

// ---- Generic error handler --------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 3001;

async function boot() {
  try {
    await migrate();
    await seedConfig();   // configurable lists, if empty
    await backfill();     // migrate any older rows to the new model
    try { const { applyRoles } = require("./config"); const { query } = require("./db"); const rr = await query("SELECT * FROM roles"); applyRoles(rr.rows); } catch (e) { console.error("role load failed:", e.message); }
    if (String(process.env.SEED_ON_BOOT).toLowerCase() === "true") {
      await seed();
    }
  } catch (e) {
    console.error("Startup database step failed:", e.message);
  }
  app.listen(PORT, () => console.log(`storage.ae Employee Management listening on ${PORT}`));
}

boot();
