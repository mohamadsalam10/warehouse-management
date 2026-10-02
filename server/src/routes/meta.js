const express = require("express");
const { requireAuth } = require("../auth");
const { query } = require("../db");
const { COUNTRIES, PHASES, STAGE_OWNER, ROLES, KIT_ITEMS, STAGE_DOCS } = require("../config");

const router = express.Router();

// Everything the client needs: fixed rules + configurable lists from the DB.
router.get("/", requireAuth, async (req, res) => {
  const [positions, cities, warehouses, bonusTypes, docTypes, uniformItems, salaryComps] = await Promise.all([
    query("SELECT name FROM positions ORDER BY name"),
    query("SELECT country, name FROM cities ORDER BY country, name"),
    query("SELECT city, name FROM warehouses ORDER BY city, name"),
    query("SELECT name FROM bonus_types ORDER BY name"),
    query("SELECT name, notice_days FROM document_types ORDER BY name"),
    query("SELECT name, default_qty FROM uniform_items ORDER BY name"),
    query("SELECT name, kind, input_kind, formula FROM salary_components ORDER BY sort_order, name"),
  ]);
  res.json({
    countries: COUNTRIES, phases: PHASES, stageOwner: STAGE_OWNER, roles: ROLES, kitItems: KIT_ITEMS, stageDocs: STAGE_DOCS,
    positions: positions.rows.map((r) => r.name),
    cities: cities.rows,
    warehouses: warehouses.rows,
    bonusTypes: bonusTypes.rows.map((r) => r.name),
    documentTypes: docTypes.rows.map((r) => ({ name: r.name, noticeDays: r.notice_days })),
    uniformItems: uniformItems.rows.map((r) => ({ name: r.name, defaultQty: r.default_qty })),
    salaryComponents: salaryComps.rows.map((r) => ({ name: r.name, kind: r.kind, inputKind: r.input_kind, formula: r.formula || "" })),
  });
});

module.exports = router;
