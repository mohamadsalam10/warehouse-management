const { query } = require("./db");

// Returns the employee's current contract, creating one from their start/contract dates if none exists.
async function currentContract(empId) {
  let c = (await query("SELECT * FROM contracts WHERE employee_id=$1 AND is_current=true ORDER BY id DESC LIMIT 1", [empId])).rows[0];
  if (!c) {
    const info = (await query(
      `SELECT cand.start_date, p.contract_start, p.contract_expiry, cand.flight_ticket_status, cand.flight_ticket_name, cand.flight_ticket_file
       FROM candidates cand LEFT JOIN employee_profiles p ON p.employee_id=cand.id WHERE cand.id=$1`, [empId])).rows[0] || {};
    const start = info.contract_start || info.start_date || new Date();
    const ins = await query(
      "INSERT INTO contracts (employee_id, start_date, end_date, is_current, ticket_status, ticket_name, ticket_file) VALUES ($1,$2,$3,true,$4,$5,$6) RETURNING *",
      [empId, start, info.contract_expiry || null, info.flight_ticket_status || "available", info.flight_ticket_name || null, info.flight_ticket_file || null]);
    c = ins.rows[0];
  }
  return c;
}

// The first contract owns legacy records. A renewed contract owns records created after it opened.
async function contractCutoff(empId, contract) {
  const r = await query("SELECT EXISTS(SELECT 1 FROM contracts WHERE employee_id=$1 AND id<>$2) AS yes", [empId, contract.id]);
  return r.rows[0].yes ? contract.created_at : null;
}

module.exports = { currentContract, contractCutoff };
