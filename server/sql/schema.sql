-- storage.ae Employee Management schema (idempotent: safe to run on every boot)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'hr',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS candidates (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE,
  name        TEXT NOT NULL,
  job_role    TEXT NOT NULL,
  country     TEXT NOT NULL,
  city        TEXT NOT NULL,
  warehouse   TEXT NOT NULL DEFAULT '-',
  phase       TEXT NOT NULL DEFAULT 'Recruitment',
  stage       TEXT NOT NULL DEFAULT 'Pending interview',
  kind        TEXT NOT NULL DEFAULT 'candidate',   -- 'candidate' | 'employee'
  cv_filename TEXT,
  cv_mime     TEXT,
  cv_bytes    BYTEA,
  stage_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'candidate';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cv_filename TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cv_mime TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cv_bytes BYTEA;

CREATE TABLE IF NOT EXISTS kit_orders (
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, item)
);

CREATE TABLE IF NOT EXISTS candidate_events (
  id           SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  detail       TEXT,
  actor        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configurable setup lists
CREATE TABLE IF NOT EXISTS positions  ( id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL );
CREATE TABLE IF NOT EXISTS cities      ( id SERIAL PRIMARY KEY, country TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (country, name) );
CREATE TABLE IF NOT EXISTS warehouses  ( id SERIAL PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (city, name) );
CREATE TABLE IF NOT EXISTS bonus_types ( id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL );

CREATE INDEX IF NOT EXISTS idx_candidates_scope ON candidates (country, city);
CREATE INDEX IF NOT EXISTS idx_candidates_kind ON candidates (kind);
CREATE INDEX IF NOT EXISTS idx_events_candidate ON candidate_events (candidate_id);

-- Accounting: monthly salary sheets (one row per employee per month)
CREATE TABLE IF NOT EXISTS salary_sheets (
  employee_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,                 -- 'YYYY-MM'
  base        NUMERIC NOT NULL DEFAULT 0,
  bonuses     JSONB NOT NULL DEFAULT '{}',   -- { "Attendance": 100, ... }
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | ready | transferred
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, month)
);

-- Accounting: pending payments for rejected trainees (days worked owed)
CREATE TABLE IF NOT EXISTS pending_payments (
  id          SERIAL PRIMARY KEY,
  person_id   INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  position    TEXT,
  country     TEXT,
  city        TEXT,
  days        INTEGER NOT NULL,
  daily_rate  NUMERIC NOT NULL,
  amount      NUMERIC NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | paid
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ
);

-- Interview calendars, each attached to a user (the interviewer/manager)
CREATE TABLE IF NOT EXISTS calendars (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_slots (
  id           SERIAL PRIMARY KEY,
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  slot_date    DATE NOT NULL,
  slot_time    TEXT NOT NULL,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, slot_date, slot_time)
);
CREATE INDEX IF NOT EXISTS idx_pending_scope ON pending_payments (country, city, status);
CREATE INDEX IF NOT EXISTS idx_slots_cal ON interview_slots (calendar_id);

-- Recruitment decision data (Slice: offers & rejections)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS salary          NUMERIC;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS start_date      DATE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS shortlist_notes TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS trial_notes     TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS reject_reason   TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS rejected_from   TEXT;

-- Uploadable employee documents (used by document processing, profiles, expiry tracker)
CREATE TABLE IF NOT EXISTS employee_documents (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  filename     TEXT, mime TEXT, bytes BYTEA,
  expiry_date  DATE,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_docs_emp ON employee_documents (employee_id);
CREATE INDEX IF NOT EXISTS idx_docs_expiry ON employee_documents (expiry_date);

-- Employee profile (personal, contact, contract) and leave records
CREATE TABLE IF NOT EXISTS employee_profiles (
  employee_id     INTEGER PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  date_of_birth   DATE, nationality TEXT, gender TEXT, marital_status TEXT,
  passport_no     TEXT, emirates_id_no TEXT,
  phone           TEXT, email TEXT, address TEXT,
  emergency_name  TEXT, emergency_relation TEXT, emergency_phone TEXT,
  contract_start  DATE, contract_expiry DATE,
  leave_entitlement INTEGER NOT NULL DEFAULT 30,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_leaves (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  start_date  DATE, end_date DATE, days INTEGER NOT NULL,
  type        TEXT NOT NULL DEFAULT 'Annual',
  status      TEXT NOT NULL DEFAULT 'Planned',  -- Planned | Taken
  notes       TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leaves_emp ON employee_leaves (employee_id);

-- Document types with an expiry notice window (drives the document-expiry work orders)
CREATE TABLE IF NOT EXISTS document_types (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, notice_days INTEGER NOT NULL DEFAULT 30
);

-- Configurable interview calendar hours and slot length
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS start_hour   INTEGER NOT NULL DEFAULT 8;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS end_hour     INTEGER NOT NULL DEFAULT 18;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS slot_minutes INTEGER NOT NULL DEFAULT 60;

-- Uniform / procurement items and per-employee orders
CREATE TABLE IF NOT EXISTS uniform_items ( id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL );
CREATE TABLE IF NOT EXISTS procurement_orders (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  item        TEXT NOT NULL,
  size        TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | ordered | received
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ordered_at  TIMESTAMPTZ, received_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_proc_emp ON procurement_orders (employee_id);

-- Procurement: grouped work orders (header + line items) and per-item default quantities
ALTER TABLE procurement_orders ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE procurement_orders ALTER COLUMN item DROP NOT NULL;
CREATE TABLE IF NOT EXISTS procurement_order_items (
  id       SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
  item     TEXT NOT NULL, size TEXT, quantity INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_proc_items ON procurement_order_items (order_id);
ALTER TABLE uniform_items ADD COLUMN IF NOT EXISTS default_qty INTEGER NOT NULL DEFAULT 0;

-- Employee self-service portal: login credentials and requests
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portal_email TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_email ON candidates (lower(portal_email)) WHERE portal_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_requests (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,             -- Vacation | Sick leave | Uniform | Other
  start_date    DATE, end_date DATE, days INTEGER,
  item          TEXT, size TEXT, quantity INTEGER,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending',   -- Pending | Approved | Rejected
  decided_by    TEXT, decided_at TIMESTAMPTZ, decision_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_emp ON employee_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON employee_requests (status);

-- Salary components (replaces bonus_types): bonus/deduction, direct amount or formula
CREATE TABLE IF NOT EXISTS salary_components (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bonus',        -- bonus | deduction
  input_kind TEXT NOT NULL DEFAULT 'amount', -- amount | formula
  formula TEXT, sort_order INTEGER DEFAULT 0
);

-- Medical reports for sick leave: excused (approved) leave is recorded but not deducted
ALTER TABLE employee_leaves    ADD COLUMN IF NOT EXISTS deductible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE employee_requests  ADD COLUMN IF NOT EXISTS report_filename TEXT;
ALTER TABLE employee_requests  ADD COLUMN IF NOT EXISTS report_mime TEXT;
ALTER TABLE employee_requests  ADD COLUMN IF NOT EXISTS report_bytes BYTEA;
ALTER TABLE employee_requests  ADD COLUMN IF NOT EXISTS report_approved BOOLEAN;

-- Contact email on candidates (used for pending-payment signature forms)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS email TEXT;

-- Pending payment dual-signature workflow (employee + manager sign via emailed link)
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_email     TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_email      TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_token     TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_token      TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_signature TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_signed_at TIMESTAMPTZ;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_signature  TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_signed_at  TIMESTAMPTZ;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS signed_pdf         BYTEA;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_pp_emp_token ON pending_payments (employee_token);
CREATE INDEX IF NOT EXISTS idx_pp_mgr_token ON pending_payments (manager_token);

-- WhatsApp contact numbers (settlement signature links sent via respond.io)
ALTER TABLE candidates       ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_phone TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_phone  TEXT;

-- App settings (key/value) so integration config lives in the DB, not env vars
CREATE TABLE IF NOT EXISTS app_settings ( key TEXT PRIMARY KEY, value TEXT );

-- Interviewer WhatsApp number on calendars (for interview notifications)
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS phone TEXT;

-- Uniform sizes collected from the employee via a WhatsApp link, plus a token for that public form
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS shoe_size   TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pants_size  TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tshirt_size TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sizes_token TEXT;
CREATE INDEX IF NOT EXISTS idx_cand_sizes_token ON candidates (sizes_token);

-- Remap old documentation stage names to the new flow (runs each boot; no-op once migrated)
UPDATE candidates SET stage='Documents Collection'   WHERE stage='Document gathering';
UPDATE candidates SET stage='PRO Processing'          WHERE stage='Processing' AND phase='Documentation';
UPDATE candidates SET stage='Medical and Tawjeeh'     WHERE stage='Medical & Tawjeeh';
UPDATE candidates SET stage='Visa and Emirates ID'    WHERE stage IN ('Biometric','EID');
UPDATE candidates SET stage='Insurance registration'  WHERE stage='Insurance' AND phase='Documentation';

-- Staff phone (for training-assignment WhatsApp) + per-stage training assignment
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE TABLE IF NOT EXISTS training_assignments (
  candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  assignee_id   INTEGER REFERENCES users(id),
  assignee_name TEXT,
  assigned_by   TEXT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (candidate_id, stage)
);
-- Rename training stage Application (BA) -> Application
UPDATE candidates SET stage='Application' WHERE stage='Application (BA)';
UPDATE training_assignments SET stage='Application' WHERE stage='Application (BA)';

-- Drawn signature images (base64 PNG) for the settlement signing page
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS employee_sig_img TEXT;
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS manager_sig_img  TEXT;

-- Referral source on applicants ("Through") + amount on requests (reimbursements)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS through TEXT;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS amount NUMERIC;

-- Custom roles with per-page access (admin is protected and always full access)
CREATE TABLE IF NOT EXISTS roles (
  key       TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  owner     TEXT,
  pages     JSONB NOT NULL DEFAULT '[]',
  is_admin  BOOLEAN NOT NULL DEFAULT false,
  protected BOOLEAN NOT NULL DEFAULT false
);

-- Leave rule settings are in app_settings (leave_notice_days, max_movers_on_leave).
-- Insurance expiry + referral link on candidates; category on procurement orders (uniform | facility).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS insurance_expiry DATE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referrer_phone   TEXT;
ALTER TABLE procurement_orders ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'uniform';

-- Positions carry a Team (Warehouse | Movers) used by the leave coverage rule
ALTER TABLE positions ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'Warehouse';

-- Self-service interview booking token + collection response fields (passport/photo/visa)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS booking_token TEXT;
CREATE INDEX IF NOT EXISTS idx_cand_booking_token ON candidates (booking_token);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS visa_status   TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS passport_file BYTEA;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS passport_name TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS photo_file    BYTEA;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS photo_name    TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS collection_submitted_at TIMESTAMPTZ;

-- Persisted time spent in each stage (seconds per stage), accumulated on every stage change
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage_durations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Extra (bonus) leave days per employee; flight-ticket status + attachment per contract
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS bonus_leave_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS flight_ticket_status TEXT DEFAULT 'available';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS flight_ticket_file   BYTEA;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS flight_ticket_name   TEXT;

-- Shareable token so a payslip document can be opened via a public link
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE INDEX IF NOT EXISTS idx_empdoc_share_token ON employee_documents (share_token);

-- Contracts: each employee has periods; vacation accrual + flight ticket are per contract.
CREATE TABLE IF NOT EXISTS contracts (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE,
  is_current    BOOLEAN NOT NULL DEFAULT true,
  ticket_status TEXT NOT NULL DEFAULT 'available',   -- available | taken
  ticket_file   BYTEA, ticket_name TEXT,
  closed_at     TIMESTAMPTZ,
  snapshot_entitlement INTEGER, snapshot_taken INTEGER, snapshot_unused NUMERIC,
  settled_used       NUMERIC NOT NULL DEFAULT 0,
  settled_reimbursed NUMERIC NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_emp ON contracts (employee_id, is_current);
ALTER TABLE contracts ALTER COLUMN snapshot_unused TYPE NUMERIC;
ALTER TABLE contracts ALTER COLUMN settled_used TYPE NUMERIC;
ALTER TABLE contracts ALTER COLUMN settled_reimbursed TYPE NUMERIC;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS contract_ticket_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_contract_ticket ON employee_documents (contract_ticket_id);
INSERT INTO employee_documents (employee_id, contract_ticket_id, label, filename, mime, bytes, uploaded_by)
SELECT employee_id, id, 'Flight ticket · ' || start_date::text || ' → ' || COALESCE(end_date::text, 'ongoing'),
       ticket_name, CASE WHEN lower(ticket_name) LIKE '%.pdf' THEN 'application/pdf'
                         WHEN lower(ticket_name) LIKE '%.png' THEN 'image/png'
                         WHEN lower(ticket_name) LIKE '%.jpg' OR lower(ticket_name) LIKE '%.jpeg' THEN 'image/jpeg'
                         ELSE 'application/octet-stream' END, ticket_file, 'Contract ticket'
FROM contracts WHERE ticket_file IS NOT NULL
ON CONFLICT (contract_ticket_id) DO NOTHING;

-- Dated adjustments to unused days from a closed contract.
CREATE TABLE IF NOT EXISTS contract_settlements (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('used', 'reimbursed')),
  days NUMERIC NOT NULL CHECK (days > 0),
  start_date DATE, end_date DATE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_settlements_contract ON contract_settlements (contract_id);

-- Recorded compensation days (extra days for working a day off): date + note, credits leave.
CREATE TABLE IF NOT EXISTS leave_compensations (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  comp_date   DATE,
  days        NUMERIC NOT NULL DEFAULT 1,
  note        TEXT,
  created_by  TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_emp ON leave_compensations (employee_id);
