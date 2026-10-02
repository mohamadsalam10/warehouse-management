const jwt = require("jsonwebtoken");
const { canSee } = require("./config");

const SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";
const EXPIRES_IN = "7d";

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name, kind: "user" }, SECRET, { expiresIn: EXPIRES_IN });
}
function signEmployeeToken(emp) {
  return jwt.sign({ sub: emp.id, name: emp.name, kind: "employee" }, SECRET, { expiresIn: EXPIRES_IN });
}

// Staff auth: attach req.user. Rejects employee tokens.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.kind === "employee") return res.status(403).json({ error: "Employee accounts cannot access this" });
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, sign in again" });
  }
}

// Employee (self-service portal) auth: attach req.employee.
function requireEmployee(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.kind !== "employee") return res.status(403).json({ error: "Not an employee session" });
    req.employee = { id: payload.sub, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, sign in again" });
  }
}

function requirePage(pageId) {
  return (req, res, next) => {
    if (!canSee(req.user.role, pageId)) return res.status(403).json({ error: "Your role does not have access to this" });
    next();
  };
}

module.exports = { signToken, signEmployeeToken, requireAuth, requireEmployee, requirePage, SECRET };
