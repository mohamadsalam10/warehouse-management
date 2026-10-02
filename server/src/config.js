// Single source of truth for the lifecycle and access model.

const COUNTRIES = {
  UAE: { label: "United Arab Emirates", flag: "\uD83C\uDDE6\uD83C\uDDEA", docStages: ["Medical", "Tawjeeh", "Emirates ID", "Visa stamp"] },
  KSA: { label: "Saudi Arabia", flag: "\uD83C\uDDF8\uD83C\uDDE6", docStages: ["Medical", "Iqama", "Muqeem", "Insurance"] },
};

const PHASES = [
  { key: "Recruitment", stages: ["Pending interview", "Shortlisted", "Interview", "Trial", "Offer"] },
  { key: "Documentation", stages: ["Documents Collection", "PRO Processing", "Contract Approval", "Medical and Tawjeeh", "Visa and Emirates ID", "Insurance registration"] },
  { key: "Training", stages: ["Basics", "Safety", "Application"] },
  { key: "Active", stages: ["Active"] },
];

const STAGE_OWNER = {
  "Pending interview": "HR", Shortlisted: "HR", Interview: "You", Trial: "Ops lead", Offer: "You",
  "Documents Collection": "HR", "PRO Processing": "PRO", "Contract Approval": "HR", "Medical and Tawjeeh": "PRO", "Visa and Emirates ID": "PRO", "Insurance registration": "PRO",
  Medical: "PRO", Tawjeeh: "PRO", "Emirates ID": "PRO", "Visa stamp": "PRO", Iqama: "PRO", Muqeem: "PRO",
  Uniform: "HR", "Warehouse assigned": "Ops lead",
  Basics: "\u2014", Safety: "\u2014", Application: "\u2014", Active: "\u2014", Rejected: "\u2014",
};

// Stages from which someone can be rejected and owe a training/trial payment.
const REJECTABLE = ["Trial", "Basics", "Safety", "Application"];

const DEFAULT_ROLES = {
  admin: { label: "Admin", owner: "You", pages: "*" },
  hr: { label: "HR", owner: "HR", pages: ["overview", "applicants", "shortlist", "interviews", "trials", "offers", "rejected", "documents", "procurement", "employees", "calendar", "leave-tracker", "doc-expiry", "requests"] },
  pro: { label: "PRO", owner: "PRO", pages: ["overview", "documents"] },
  procurement: { label: "Procurement", owner: "Procurement", pages: ["overview", "procurement"] },
  facility: { label: "Facility", owner: "Facility", pages: ["overview", "matrix", "warehouses"], trainingFocus: "Safety" },
  ld: { label: "Training (L&D)", owner: "L&D", pages: ["overview", "matrix", "employees"], trainingFocus: "Basics" },
  ba: { label: "Business analyst", owner: "BA", pages: ["overview", "matrix"], trainingFocus: "Application" },
  accountant: { label: "Accountant", owner: "Accountant", pages: ["overview", "salaries", "pending-payments"] },
};

// Live role map (mutated in place so modules holding a reference stay in sync). Seeded from DB on boot.
const ROLES = {};
for (const k of Object.keys(DEFAULT_ROLES)) ROLES[k] = DEFAULT_ROLES[k];
function applyRoles(rows) {
  if (!rows || !rows.length) return;
  for (const k of Object.keys(ROLES)) delete ROLES[k];
  for (const r of rows) ROLES[r.key] = { label: r.label, owner: r.owner || undefined, pages: r.is_admin ? "*" : (Array.isArray(r.pages) ? r.pages : []) };
}

// Pages a custom role can be granted access to.
const PAGE_CATALOG = [
  { id: "overview", label: "Overview and warehouses" },
  { id: "applicants", label: "Recruitment: applicants" },
  { id: "shortlist", label: "Recruitment: shortlist" },
  { id: "interviews", label: "Recruitment: interviews" },
  { id: "trials", label: "Recruitment: trials" },
  { id: "offers", label: "Recruitment: offers" },
  { id: "rejected", label: "Recruitment: rejected" },
  { id: "calendar", label: "Interview calendar" },
  { id: "documents", label: "Document processing" },
  { id: "procurement", label: "Procurement / uniform orders" },
  { id: "matrix", label: "Training matrix" },
  { id: "employees", label: "Employees" },
  { id: "requests", label: "Requests" },
  { id: "leave-tracker", label: "Leave and vacations" },
  { id: "salaries", label: "Salaries" },
  { id: "pending-payments", label: "Pending payments" },
  { id: "users", label: "Users" },
  { id: "setup", label: "Setup" },
];

const KIT_ITEMS = ["Uniform", "Safety boots", "ID card"];
const KIT_NEXT = { pending: "ordered", ordered: "received", received: "pending" };

function lifecycle(country) { return PHASES.map((p) => ({ ...p })); }
function flatStages(country) {
  const flat = [];
  lifecycle(country).forEach((p) => p.stages.forEach((s) => flat.push({ phase: p.key, stage: s })));
  return flat;
}
function nextOf(country, phase, stage) {
  const flat = flatStages(country);
  const i = flat.findIndex((f) => f.phase === phase && f.stage === stage);
  return i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
}
const STAGE_DOCS = {
  "Documents Collection": "Passport",
  "Contract Approval": "Contract",
  "Visa and Emirates ID": "Emirates ID",
  "Insurance registration": "Insurance card",
};

function firstDocStage() { return PHASES.find((p) => p.key === "Documentation").stages[0]; }

function canSee(role, pageId) { const r = ROLES[role]; return !!r && (r.pages === "*" || r.pages.includes(pageId)); }
function canAdvance(role, stage) { return role === "admin" || (ROLES[role] && STAGE_OWNER[stage] === ROLES[role].owner); }
function isAdmin(role) { return role === "admin"; }
function ownsStage(role, stage) { return role === "admin" || (ROLES[role] && STAGE_OWNER[stage] === ROLES[role].owner); }
function canReject(role, stage) { return REJECTABLE.includes(stage) && (role === "admin" || role === "hr" || ownsStage(role, stage)); }

module.exports = {
  STAGE_DOCS,
  COUNTRIES, PHASES, STAGE_OWNER, ROLES, DEFAULT_ROLES, applyRoles, PAGE_CATALOG, KIT_ITEMS, KIT_NEXT, REJECTABLE,
  lifecycle, flatStages, nextOf, firstDocStage, canSee, canAdvance, isAdmin, ownsStage, canReject,
};
