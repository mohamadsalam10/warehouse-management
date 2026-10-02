require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./db");
const { KIT_ITEMS } = require("./config");

const DEMO_PASSWORD = "storage123";

const USERS = [
  ["Admin User", "admin@storage.ae", "admin"],
  ["Huda (HR)", "hr@storage.ae", "hr"],
  ["Rashid (PRO)", "pro@storage.ae", "pro"],
  ["Sara (Procurement)", "procurement@storage.ae", "procurement"],
  ["Faisal (Facility)", "facility@storage.ae", "facility"],
  ["Layla (L&D)", "ld@storage.ae", "ld"],
  ["Bilal (BA)", "ba@storage.ae", "ba"],
  ["Noura (Accounts)", "accountant@storage.ae", "accountant"],
];

// name, position, country, city, warehouse, phase, stage, daysInStage, kind
const PEOPLE = [
  ["Arjun Menon", "Warehouse picker", "UAE", "Dubai", "-", "Recruitment", "Interview", 1, "candidate"],
  ["Maria Santos", "Inventory clerk", "UAE", "Dubai", "-", "Recruitment", "Offer", 2, "candidate"],
  ["Kwame Mensah", "Loader", "UAE", "Dubai", "-", "Recruitment", "Pending interview", 0, "candidate"],
  ["Rahul Verma", "Forklift operator", "UAE", "Dubai", "-", "Recruitment", "Trial", 2, "candidate"],
  ["Bilal Ahmed", "Packer", "UAE", "Dubai", "-", "Recruitment", "Shortlisted", 3, "candidate"],
  ["Grace Okafor", "Warehouse picker", "UAE", "Dubai", "Jebel Ali", "Documentation", "Document gathering", 1, "employee"],
  ["Deepak Nair", "Driver", "UAE", "Dubai", "Al Quoz", "Documentation", "Processing", 4, "employee"],
  ["Fatima Zahra", "Inventory clerk", "UAE", "Dubai", "Jebel Ali", "Documentation", "Medical & Tawjeeh", 6, "employee"],
  ["Samuel Adeyemi", "Loader", "UAE", "Dubai", "Al Quoz", "Training", "Basics", 1, "employee"],
  ["Priya Sharma", "Packer", "UAE", "Dubai", "Jebel Ali", "Training", "Safety", 0, "employee"],
  ["John Dela Cruz", "Forklift operator", "UAE", "Dubai", "Al Quoz", "Training", "Basics", 1, "employee"],
  ["Ayesha Khan", "Warehouse picker", "UAE", "Dubai", "Jebel Ali", "Training", "Safety", 2, "employee"],
  ["Mohammed Ali", "Driver", "UAE", "Dubai", "Al Quoz", "Training", "Application (BA)", 3, "employee"],
  ["Ravi Kumar", "Packer", "UAE", "Dubai", "Al Quoz", "Active", "Active", 40, "employee"],
  ["Linh Nguyen", "Inventory clerk", "UAE", "Dubai", "Jebel Ali", "Active", "Active", 120, "employee"],
  ["Omar Farooq", "Loader", "UAE", "Abu Dhabi", "-", "Recruitment", "Interview", 2, "candidate"],
  ["Sunil Pillai", "Forklift operator", "UAE", "Abu Dhabi", "Mussafah", "Documentation", "Biometric", 8, "employee"],
  ["Aisha Bello", "Warehouse picker", "UAE", "Sharjah", "-", "Recruitment", "Trial", 1, "candidate"],
  ["Karim Nasser", "Driver", "KSA", "Riyadh", "-", "Recruitment", "Shortlisted", 1, "candidate"],
  ["Yusuf Idris", "Loader", "KSA", "Riyadh", "Sulay", "Documentation", "EID", 5, "employee"],
  ["Hassan Malik", "Packer", "KSA", "Riyadh", "Sulay", "Training", "Basics", 2, "employee"],
];

const KIT = {
  "Samuel Adeyemi": ["ordered", "pending", "pending"], "Priya Sharma": ["received", "ordered", "pending"],
  "John Dela Cruz": ["received", "received", "received"], "Ayesha Khan": ["received", "received", "ordered"],
};

const POSITIONS = ["Warehouse picker", "Packer", "Loader", "Forklift operator", "Driver", "Inventory clerk"];
const CITIES = [["UAE", "Dubai"], ["UAE", "Abu Dhabi"], ["UAE", "Sharjah"], ["KSA", "Riyadh"], ["KSA", "Jeddah"]];
const WAREHOUSES = [["Dubai", "Al Quoz"], ["Dubai", "Jebel Ali"], ["Abu Dhabi", "Mussafah"], ["Sharjah", "Industrial 15"], ["Riyadh", "Sulay"]];
const BONUS_TYPES = ["Attendance", "Performance", "Overtime"];
const UNIFORM_ITEMS = [["T-shirt", 2], ["Pants", 2], ["Shoes", 1]];
const DOC_TYPES = [["Insurance", 45], ["EID", 60], ["Passport", 90], ["Visa", 30], ["Medical & Tawjeeh", 30], ["Labour card", 45], ["Contract", 60]];

async function count(table) { const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`); return r.rows[0].n; }

// Populate configurable lists if empty. Runs on every boot.
async function seedConfig() {
  const demo = String(process.env.SEED_DEMO).toLowerCase() === "true";
  if (demo && (await count("positions")) === 0) for (const p of POSITIONS) await pool.query("INSERT INTO positions (name) VALUES ($1) ON CONFLICT DO NOTHING", [p]);
  if (demo && (await count("cities")) === 0) for (const [c, n] of CITIES) await pool.query("INSERT INTO cities (country, name) VALUES ($1,$2) ON CONFLICT DO NOTHING", [c, n]);
  if (demo && (await count("warehouses")) === 0) for (const [c, n] of WAREHOUSES) await pool.query("INSERT INTO warehouses (city, name) VALUES ($1,$2) ON CONFLICT DO NOTHING", [c, n]);
  if (demo && (await count("bonus_types")) === 0) for (const b of BONUS_TYPES) await pool.query("INSERT INTO bonus_types (name) VALUES ($1) ON CONFLICT DO NOTHING", [b]);
  if (demo && (await count("document_types")) === 0) for (const [n, d] of DOC_TYPES) await pool.query("INSERT INTO document_types (name, notice_days) VALUES ($1,$2) ON CONFLICT DO NOTHING", [n, d]);
  if (demo && (await count("uniform_items")) === 0) for (const [u, q] of UNIFORM_ITEMS) await pool.query("INSERT INTO uniform_items (name, default_qty) VALUES ($1,$2) ON CONFLICT DO NOTHING", [u, q]);
  if ((await count("roles")) === 0) {
    const { DEFAULT_ROLES } = require("./config");
    for (const [key, r] of Object.entries(DEFAULT_ROLES)) {
      const isAdmin = r.pages === "*";
      await pool.query("INSERT INTO roles (key, label, owner, pages, is_admin, protected) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING",
        [key, r.label, r.owner || null, JSON.stringify(isAdmin ? [] : r.pages), isAdmin, key === "admin"]);
    }
  }
}

// Migrate any pre-existing rows to the new model. Idempotent.
async function backfill() {
  await pool.query("UPDATE candidates SET stage='Pending interview' WHERE stage='Sourced'");
  await pool.query("UPDATE candidates SET stage='Shortlisted' WHERE stage='Contacted'");
  await pool.query("UPDATE candidates SET kind='employee' WHERE phase <> 'Recruitment' AND kind='candidate'");
  // Map old country-specific document stages to the new document-processing sequence
  await pool.query("UPDATE candidates SET stage='Medical & Tawjeeh' WHERE stage IN ('Medical','Tawjeeh')");
  await pool.query("UPDATE candidates SET stage='EID' WHERE stage IN ('Emirates ID','Iqama')");
  await pool.query("UPDATE candidates SET stage='Biometric' WHERE stage IN ('Muqeem','Visa stamp')");
  await pool.query("UPDATE candidates SET stage='Document gathering' WHERE phase='Documentation' AND stage NOT IN ('Document gathering','Processing','Medical & Tawjeeh','Biometric','EID','Insurance')");
  // Onboarding phase removed: move any onboarding employees into training
  await pool.query("UPDATE candidates SET phase='Training', stage='Basics' WHERE phase='Onboarding'");
  // Procurement: migrate any single-item orders into line items
  await pool.query(`INSERT INTO procurement_order_items (order_id, item, size, quantity)
    SELECT id, item, size, quantity FROM procurement_orders o
    WHERE o.item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM procurement_order_items i WHERE i.order_id = o.id)`);
  await pool.query("UPDATE uniform_items SET default_qty=2 WHERE name IN ('T-shirt','Pants') AND default_qty=0");
  await pool.query("UPDATE uniform_items SET default_qty=1 WHERE name='Shoes' AND default_qty=0");
  if (demo)   await pool.query(`INSERT INTO salary_components (name, kind, input_kind)
    SELECT name, 'bonus', 'amount' FROM bonus_types b
    WHERE NOT EXISTS (SELECT 1 FROM salary_components sc WHERE sc.name = b.name)`);
}

async function seed({ force = false } = {}) {
  const demo = String(process.env.SEED_DEMO).toLowerCase() === "true";
  // Always ensure an admin login exists.
  {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO NOTHING", ["Admin", "admin@storage.ae", hash]);
  }
  if (!demo) { console.log("Admin ensured. Demo data disabled (set SEED_DEMO=true to load samples)."); return; }
  if (!force && (await count("candidates")) > 0) { console.log("Data exists, skipping demo seed."); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [name, email, role] of USERS) {
      const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
      await client.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING", [name, email, hash, role]);
    }
    for (let i = 0; i < PEOPLE.length; i++) {
      const [name, pos, country, city, wh, phase, stage, days, kind] = PEOPLE[i];
      const code = `EMP-${1042 + i}`;
      const stageSince = new Date(Date.now() - days * 86400000).toISOString();
      const res = await client.query(
        `INSERT INTO candidates (code, name, job_role, country, city, warehouse, phase, stage, kind, stage_since)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [code, name, pos, country, city, wh, phase, stage, kind, stageSince]
      );
      const id = res.rows[0].id;
      const kit = KIT[name] || ["pending", "pending", "pending"];
      for (let k = 0; k < KIT_ITEMS.length; k++) await client.query("INSERT INTO kit_orders (candidate_id, item, status) VALUES ($1,$2,$3)", [id, KIT_ITEMS[k], kit[k]]);
    }
    // Demo employee portal logins (password: employee123)
    const demoPortal = { "Ravi Kumar": "ravi@storage.ae", "Linh Nguyen": "linh@storage.ae" };
    const empHash = await bcrypt.hash("employee123", 10);
    for (const [nm, mail] of Object.entries(demoPortal)) {
      await client.query("UPDATE candidates SET portal_email=$1, portal_password_hash=$2 WHERE name=$3 AND kind='employee'", [mail, empHash, nm]);
    }
    await client.query("COMMIT");
    console.log(`Seeded ${USERS.length} users and ${PEOPLE.length} people. Demo login: admin@storage.ae / ${DEMO_PASSWORD}`);
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

module.exports = { seed, seedConfig, backfill };

if (require.main === module) {
  const force = process.argv.includes("--force");
  (async () => { await seedConfig(); await backfill(); await seed({ force }); })().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
