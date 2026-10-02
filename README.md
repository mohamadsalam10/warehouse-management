# storage.ae · People Operations

Recruitment to onboarding to training, in one dashboard, with role-based access.
Full stack: React (Vite) client, Express + Postgres API, JWT auth. One repo, deploys
to Render as a single web service plus a managed Postgres database.

## What it does

- Tracks every hire through the lifecycle: Recruitment (Sourced, Contacted, Interview,
  Trial, Offer) into Documentation (government papers, per country) into Onboarding
  (uniform and warehouse) into Training (basics, safety, application) into Active.
- Country and city aware. Switch UAE to KSA and the documentation stages change with it.
- Every stage has an owner, so handoffs between HR, PRO, procurement, facility, L&D and
  the BA are visible rather than chased over WhatsApp.
- Access levels. Each person signs in and sees only their pages. Restrictions are enforced
  on the server, so hiding a page in the UI is backed by a real permission check.

## Roles

| Role | Sees |
| --- | --- |
| Admin | Everything |
| HR | Recruitment, documents, onboarding, employees, can add candidates |
| PRO | Document tracker only |
| Procurement | Kit orders only (uniform, safety boots, ID card) |
| Facility | Training matrix (safety) and warehouses |
| Training (L&D) | Training matrix (basics) and employees |
| Business analyst | Training matrix (application) |

A role may only advance a candidate whose current stage it owns. For example HR advances
Sourced and Contacted, the PRO advances the paperwork stages, the BA passes application
training. Admin can do anything.

## Tech

- Client: React 18, Vite, lucide-react. The storage.ae design system lives in
  `client/src/styles.css` (orange first, Poppins, hairline borders, no shadows).
- Server: Express, `pg`, `bcryptjs`, `jsonwebtoken`.
- Database: Postgres. Schema in `server/sql/schema.sql`. Tables: users, candidates,
  kit_orders, candidate_events.
- The domain model (countries, lifecycle, roles) is defined once in
  `server/src/config.js` and served to the client via `GET /api/meta`, so the two never
  drift.

## Run it locally

You need Node 18+ and a Postgres database.

```bash
# 1. install everything (npm workspaces)
npm install

# 2. configure environment
cp .env.example .env
# edit .env: set DATABASE_URL to your local Postgres, e.g.
#   DATABASE_URL=postgres://localhost:5432/storage_ae
# create the database first if needed:  createdb storage_ae

# 3. create tables and seed demo data
npm run migrate
npm run seed          # add --force to reseed: npm run seed -- --force

# 4. start API (3001) and client (5173) together
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the Express server, so there are no
CORS issues in development.

### Demo accounts

Password for all of them: `storage123`

```
admin@storage.ae         hr@storage.ae         pro@storage.ae
procurement@storage.ae   facility@storage.ae   ld@storage.ae   ba@storage.ae
accountant@storage.ae
```

Change these before any real use.

## Deploy to Render through GitHub

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "storage.ae people operations"
git branch -M main
git remote add origin https://github.com/<you>/storage-ae-employee-management.git
git push -u origin main
```

### 2. Create the services on Render

This repo has a `render.yaml` blueprint, so Render can set up both the web service and the
database in one step.

1. In the Render dashboard: **New +** then **Blueprint**.
2. Connect your GitHub account and pick this repository.
3. Render reads `render.yaml` and proposes one web service and one Postgres database. Apply.

Render wires it up for you:

- `DATABASE_URL` is injected from the database.
- `JWT_SECRET` is generated.
- `SEED_ON_BOOT` is `true`, so the first boot creates the tables and seeds the demo data.
- Build command: `npm install && npm run build` (installs workspaces, builds the client).
- Start command: `npm start` (Express serves the API and the built client from the same
  service, so there is only one public URL).
- Health check: `/api/health`.

When it goes live, open the service URL and sign in with a demo account.

### After first deploy

- Turn seeding off once real data exists: set `SEED_ON_BOOT` to `false` in the service
  Environment settings, or delete the variable.
- The free Postgres and web instances sleep and expire on Render's free tier. Move to a
  paid instance for anything beyond a trial.

## Deploy manually (without the blueprint)

1. Create a Postgres database on Render, copy its **Internal Database URL**.
2. Create a **Web Service** from the repo. Environment: Node.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. Add environment variables: `DATABASE_URL` (the internal URL), `JWT_SECRET` (a long
   random string), `SEED_ON_BOOT` = `true`, `NODE_ENV` = `production`.

## Project layout

```
.
├── render.yaml            Render blueprint (web service + Postgres)
├── package.json           workspaces + dev/build/start scripts
├── client/                React + Vite front end
│   └── src/
│       ├── App.jsx         dashboard shell, pages, drawer
│       ├── auth.jsx        auth context (login, logout, session restore)
│       ├── api.js          fetch wrapper, attaches JWT
│       ├── styles.css      storage.ae design system
│       └── components/Login.jsx
└── server/                Express API
    ├── sql/schema.sql
    └── src/
        ├── index.js        app entry, serves API + built client
        ├── config.js       lifecycle + roles (single source of truth)
        ├── db.js           pg pool
        ├── auth.js         JWT sign/verify, requireAuth, requirePage
        ├── migrate.js      applies schema
        ├── seed.js         demo users + candidates
        └── routes/         auth, meta, candidates, kit
```

## API summary

| Method | Path | Notes |
| --- | --- | --- |
| POST | /api/auth/login | email + password, returns token |
| GET | /api/auth/me | current user (requires token) |
| GET | /api/meta | countries, lifecycle, roles, stage owners |
| GET | /api/candidates?country=&city= | scoped list |
| GET | /api/candidates/:id | detail with event history |
| POST | /api/candidates | add (HR or admin) |
| POST | /api/candidates/:id/advance | move to next stage (stage owner only) |
| POST | /api/candidates/:id/kit | cycle a kit item (procurement or admin) |

## Notes and next steps

- Fonts load from Google Fonts for convenience. For production, self-host Poppins and
  JetBrains Mono per the brand guidance.
- Candidate records are ready to grow: the `candidate_events` table already logs stage
  changes and kit updates, which is the seam for interview and trial feedback, a WhatsApp
  message log, and document expiry reminders.
- One person may need more than one role in real life. Roles are a simple list of allowed
  pages in `server/src/config.js`, so a combined role, or a user with two roles, is a small
  change from here.

## Accounting and interview calendar

**Salaries** (Accounting module, accountant + admin): a monthly sheet of every employee in
the selected city with a base salary and a column per bonus type from Setup. The manager
(admin) fills the amounts and saves; the accountant reviews and transfers. Use the month
switcher to move between months. Each month is independent and the base carries forward
from the previous month.

**Pending payments**: when someone is rejected during a trial or training (the Reject
action on those pages, or in the record drawer), you record the days worked and a daily
rate. That logs a pending payment here for the accountant to transfer and mark paid.

**Interview calendar**: an admin creates a calendar in Setup and attaches it to a user.
That user (and admin) manages their own availability, adding days and time slots on the
Interview calendar page. When HR schedules an interview, they pick a manager and a free
slot, which books it. The calendar page is visible to admin, HR, and any user who owns a
calendar.

New API endpoints: `/api/accounting/salaries`, `/api/accounting/pending-payments`,
`/api/calendars` and `/api/calendars/:id/slots`, plus `/api/candidates/:id/reject`.
The schema adds `salary_sheets`, `pending_payments`, `calendars`, and `interview_slots`,
applied automatically on the next boot.

## Recruitment decisions and offer letters

The recruitment flow now captures structured decisions and produces a branded PDF.

- **Shortlist** keeps a candidate with a note; they appear on the Shortlist page.
- **Move to trial** records a start date, warehouse and salary (these prefill the offer).
- **Make offer** sets salary and start date. On the Offers page you can download a generated
  PDF offer letter, edit the terms and regenerate it, accept (converts to employee), or
  reject the offer (moves to Rejected).
- **Reject** during trial or training logs a pending payment for the days worked and records
  which stage the person was rejected at.
- The **Rejected page** lists everyone rejected with the stage and reason.
- **Position filters** are available on Applicants, Shortlist and Rejected.

The offer letter is generated on the fly by the server (`GET /api/candidates/:id/offer-letter.pdf`)
using pdf-lib, so editing the offer and downloading again always reflects the latest terms.


## Interview calendar (weekly)

Interview calendar is a module: each manager's calendar is its own page, visible only to
that manager, HR, and admin. Managers open and close availability by clicking cells in a
weekly grid (like a simple Google Calendar). When HR books an interview from an applicant,
it appears on the manager's calendar as a booked slot showing the candidate's name and
position. Clicking a booked slot opens the candidate, where the manager records the outcome:
move to trial (with start date, warehouse, salary), shortlist with notes, or reject with a
reason. New endpoint: `/api/candidates/:id/decline`. Calendar reads are access-scoped on the
server.


## Document processing

The Documentation module is now Document processing, with a fixed sequence: document
gathering, processing, medical and tawjeeh, biometric, EID, then insurance. You advance an
employee through the stages and upload the actual documents (any file type) with an optional
expiry date, stored in the database and downloadable via the Docs button. Endpoints:
`/api/candidates/:id/documents`. Existing records migrate from the old country-specific
stages on the next boot.


## Employee profiles

Clicking an employee opens a full profile with tabs: Details (employment info plus editable
contract start/expiry and annual leave entitlement), Personal & contact (date of birth,
nationality, passport and Emirates ID numbers, phone, email, address, emergency contact),
Documents (upload/download the same employee documents), and Vacations (leave entitlement,
taken, planned and remaining, with a list of leave records you can add and remove). HR and
admin can edit; other roles with employee access can view. Endpoints:
`/api/candidates/:id/profile` and `/api/candidates/:id/leaves`.


## Expiry tracker

Two pages under the Expiry tracker module (HR and admin).

- **Leave & vacations**: every employee with contract expiry, annual leave entitlement, days
  taken and remaining, and a computed priority. Someone whose contract expires soon and who
  still has unused leave ranks highest, so their days are used before they lapse.
- **Document expiry**: a live work-order list of documents expiring soon or already expired,
  most urgent first. Whether a document appears is driven by a per-type notice window
  configured under Document types & expiry in Setup (for example, flag insurance 45 days
  before it expires). Clicking a row opens the employee's profile.

Endpoints: `/api/expiry/leaves` and `/api/expiry/documents`. Default document types and
notice windows seed on first boot.


## Batch update: overview, lifecycle and calendar tweaks

- The Overview landing page now shows the warehouse view (headcount and pipeline per
  facility for the selected city); the separate Warehouses page was folded into it.
- Shortlist is available from the Trial stage, not just before an interview.
- Document processing has a Cancel action to stop and reject a candidate mid-paperwork.
- Interview calendars have configurable working hours and slot length (60/30/15 min), set
  per calendar in Setup. `PATCH /api/calendars/:id` and new calendar columns support this.
- The Onboarding section was removed; the lifecycle now goes Recruitment, Document
  processing, Training, Active. Existing onboarding employees migrate into Training on boot.


## Procurement / uniforms

Procurement now handles uniform items (t-shirts, pants, shoes, and any item you add under
Uniform items in Setup). Raise a work order with an item, size and quantity for any employee,
then move it from pending to ordered to received. The Procurement page lists all work orders
for the selected city and lets you create new ones by picking an employee; each employee's
profile has a Uniform tab showing everything ordered for them and when. This covers new
joiners and existing staff replacing old uniforms. Endpoints: `/api/procurement/orders`.


## Procurement: auto orders and grouped work orders

- New hires get a uniform work order automatically when they pass Medical & Tawjeeh. The
  quantities come from each item's default-per-hire value in Setup (e.g. 2 t-shirts, 2 pants,
  1 shoes), and it is created as a single order, once per hire.
- A work order now holds multiple item lines and moves from pending to ordered to received as
  a whole. Manual orders are raised from a popup (New work order button) where you pick the
  employee and add as many item lines as needed; sizes and quantities on a pending order are
  editable inline (useful for filling sizes on an auto order).
- Uniform items are fully managed in Setup: add caps, jackets, shorts or anything else, each
  with its own default-per-hire quantity. Endpoints: `/api/procurement/orders` and its item
  sub-resource. Existing single-item orders migrate to the new structure on boot.


## Employee self-service portal

Employees can sign in from their phone (the Employee tab on the login screen) to a mobile
portal with bottom-tab navigation:
- Home: this month's pay, leave remaining, recent requests.
- Pay: monthly salary breakdown (base + each bonus + total + status), navigable by month.
- Time off: entitlement, taken and remaining, plus leave history.
- Docs: their documents, viewable/downloadable.
- Uniform: their uniform orders and status.
- Requests: submit and track Vacation, Sick leave, Uniform or Other requests.

HR/admin manage logins from an employee's profile (Details tab, "Employee portal access")
and act on submissions from the new Requests page: approving a leave request records the
leave, approving a uniform request raises a work order. Employees and staff use separate,
non-interchangeable sessions. Demo employee logins seed for Ravi Kumar (ravi@storage.ae) and
Linh Nguyen (linh@storage.ae), password employee123. Endpoints: `/api/portal/*` and
`/api/requests`.


## Salaries overhaul

- Base salary is set on each employee's profile (Details tab) and shown read-only on the
  salaries sheet; only bonuses and deductions are edited there.
- Salary columns are now configurable "components" (Setup → Salary components). Each is a
  bonus (added) or deduction (subtracted), and either a direct Amount or a Formula. Formulas
  use x (the value entered that month) and base (the employee's base salary) with + - * / and
  brackets, e.g. Google reviews = x * 10, overtime day = base / 30.418 * x. Amounts compute
  automatically.
- Fixed the month navigation and save bugs (a timezone issue was rolling the month back).
- Added a "Transfer all" action to release every ready sheet for the month at once, alongside
  the existing per-employee transfer.
- The employee portal pay screen reflects the same component breakdown. The portal is now
  responsive across phone, tablet and desktop widths.


## Portal trim + request flows

- The employee portal now has three tabs only: Pay, Time off and Requests.
- Uniform requests use a picker of the uniform items configured in Setup (with size and
  quantity), rather than free text.
- The staff Requests page shows, for each pending request, exactly what approving will do:
  a vacation records planned annual leave on the profile, sick leave records taken sick
  leave, a uniform request raises a uniform work order, and Other has no automatic action.
  Rejecting captures a reason that the employee sees against the request in their portal.


## Role-based training

Training is a handover pipeline across teams: L&D owns Basics, Facility owns Safety, the BA
owns Application. Each team only sees an actionable "Pass" button for the level it owns;
other levels show which team currently holds the employee. The server enforces this — only
the owning role (or admin) can advance a given stage. Column headers show each level's owning
team, and admin gets a level filter to work one level at a time like the owners do.


## Fix: /api/meta crash (502)

A missing query in the meta endpoint's Promise.all left salaryComponents undefined, so every
/api/meta call threw and (via an unhandled promise rejection) took the whole Node process
down — surfacing as a 502 for the app and its assets. Fixed the query, and added process-level
guards (unhandledRejection / uncaughtException are logged, not fatal) so a single failing
request can no longer crash the service. Verified end-to-end against a real PostgreSQL 16:
migrate + seed + backfill are idempotent across redeploys, and all API and portal endpoints
return 200 with the server staying alive.


## Medical reports for sick leave

Employees can attach a medical report (photo or PDF) to a sick-leave request from the portal.
On the staff Requests page, a sick-leave request shows a "report" link to view the attachment,
and two approval actions: Excuse (the medical report is accepted, so the days are recorded but
not deducted from the leave balance) or Deduct (approve but count the days). Sick leave without
a report is deducted on approval. The excused days appear in the employee's leave history and
portal marked "Excused", and never reduce their remaining balance. Implemented with a
`deductible` flag on leave records that every balance calculation now respects.


## Employee doc uploads, salary save fix, auto leave days

- Employees can upload their own documents (Emirates ID, passport, etc.) from a Docs tab in the
  portal, with an optional expiry; these appear on their staff profile and feed the expiry
  tracker. They can remove ones they uploaded themselves.
- Fixed the salaries save error ("put is not a function") — the API client was missing a put
  method, which also affected saving employee profiles. Both save correctly now.
- Confirmed each month's salary is independent: a bonus entered for one month does not appear
  in any other month (sheets are keyed per employee per month).
- Leave request days are now calculated automatically from the start and end dates.


## Pending payments: e-signature settlement

Instead of a single "mark paid" action, a pending payment is now settled by dual e-signature:

- Candidates have a contact email (Profile → Details). Rejected trainees owed days are settled
  through it.
- "Send for signature" creates two login-free signing links — one for the employee (receiver),
  one for the manager (payer) — and emails them if SMTP is configured (set SMTP_URL and
  MAIL_FROM). If not configured, the links are shown in-app to copy and share; set PUBLIC_URL
  so the links use your real domain.
- Each link opens a standalone, branded signing page (no website login) showing the settlement
  details; the party types their full name and confirms to sign.
- When both sign, the payment is marked paid automatically and a signed PDF (with both
  signatures and timestamps) is generated and stored. Staff can download it from the page, and
  either party can download it from their link.
- Admins retain a manual "mark paid" override for exceptional cases.

Env: SMTP_URL (nodemailer connection string) and MAIL_FROM enable real email; PUBLIC_URL sets
the base URL used in signing links (defaults to the request host).


## Settlement signatures via WhatsApp (respond.io)

The pending-payment signature links are now delivered over WhatsApp through respond.io instead
of email. Candidates have a WhatsApp number (Profile → Details). "Send for signature" messages
both the employee and the manager their signing link via the respond.io Developer API; the
links are still shown in-app to share manually. Everything else is unchanged — each link opens
the login-free signing page, and once both sign the payment settles and the signed PDF is
generated.

Env for live sending:
- RESPOND_IO_TOKEN — Developer API access token (respond.io → Settings → Integrations →
  Developer API → Add Access Token).
- RESPOND_IO_CHANNEL_ID — the WhatsApp channel id in your workspace (optional; if omitted,
  respond.io routes to the contact's last interacted channel).
- RESPOND_IO_TEMPLATE (+ RESPOND_IO_TEMPLATE_LANG, default "en") — an approved WhatsApp template
  name for business-initiated messages. WhatsApp only allows free text within a 24-hour window;
  outside it, set an approved template whose body takes the signing link as its first variable.
- PUBLIC_URL — your deployed URL, so links point to the right domain.

Numbers use full international format, e.g. +9715XXXXXXXX.


## respond.io config in-app (no env vars)

WhatsApp/respond.io is now configured inside the app instead of via server env vars:
- Credentials (Developer API token + WhatsApp channel ID) are entered once under Setup >
  WhatsApp (respond.io) and stored in the database, so they carry over when you move servers.
  Env vars (RESPOND_IO_TOKEN / RESPOND_IO_CHANNEL_ID) still work as a fallback.
- Templates live in code at server/src/whatsappTemplates.js. To add a template: approve it in
  respond.io, then add an entry here with its exact name and language (e.g. en_US). The
  settlement flow uses templates.settlement. No env var is needed for templates.


## Phone on new candidates

The Add candidate form includes a phone field: a country-code dropdown covering every country
(client/src/countryCodes.js), searchable by typing the country name, plus the local number.
They combine into a full international number stored on the candidate and used as the default
WhatsApp number for settlement links (editable later on the profile). Optional.


## Manager number from Setup + one-tap send

The manager (payer) WhatsApp number is now configured once under Setup > WhatsApp (respond.io)
and used automatically for every settlement. "Send for signature" is a single tap — the
employee's number comes from their profile, the manager's from Setup — no numbers to type.
The settlement template name and language are also editable there (default settlement_signature
/ en_US) so an exact-match fix needs no redeploy.


## Lifecycle WhatsApp notifications

Candidates and interviewers now get WhatsApp templates at key steps (via respond.io), using the
candidate's phone and the interviewer's number (set per calendar in Setup, Interview calendars):
- Scheduling an interview (with a slot): candidate gets interview_candidate; interviewer gets
  interview_interviewer.
- Moving to trial: candidate gets trial_candidate (start date + trial length in days; a Trial
  period field was added to the trial dialog).
- Making or updating an offer: candidate gets offer_candidate.
Templates are registered in server/src/whatsappTemplates.js (names must match respond.io exactly,
lowercase). Sends are best-effort and never block the action; missing numbers just skip silently.


## respond.io Inbox display fix

Template messages sent via the respond.io API are delivered to the contact by WhatsApp, but the
respond.io Inbox only shows the body if the payload also includes a plain text field. All
template sends now include the rendered message text so the Inbox shows the full content instead
of an empty bubble. Delivery was never affected.


## Document processing by stage, phone autofill, and uniform sizes by WhatsApp

- The number HR enters when adding a candidate autofills the profile WhatsApp number (and the
  profile contact phone), editable later.
- Document processing now knows what to upload at each stage: passport at Document gathering,
  medical report at Medical & Tawjeeh, Emirates ID at EID, insurance card at Insurance. The
  upload defaults to the right type for the employee's current stage and saves straight to their
  profile. (Map lives in server/src/config.js STAGE_DOCS.)
- When the uniform work order is auto-created (Medical & Tawjeeh), the employee is sent a
  WhatsApp link (uniform_sizes template) to enter T-shirt, pants and shoe sizes. Submitted sizes
  fill the matching work-order item sizes automatically and save to the profile. HR can also
  trigger this any time with "Request sizes" on a work order. Public form: /sizes/:token.


## Documentation flow rework + stage notifications

New documentation stages: Documents Collection, PRO Processing, Contract Approval, Medical and
Tawjeeh, Visa and Emirates ID, Insurance registration (old stages are remapped on boot).
- Documents Collection: "Send request" WhatsApps the candidate (documents_collection) asking for
  passport copy, digital studio photo, current visa status, and a link to submit uniform sizes
  (autofilled into the procurement order). Passport can also be uploaded (optional) and saves to
  the profile.
- Contract Approval: upload the contract (saved to profile), then proceed.
- Medical and Tawjeeh: "Notify manager" WhatsApps the manager (settlement manager number,
  medical_tawjeeh) that the candidate is ready.
- When a uniform work order is created (auto or manual), the procurement manager is WhatsApped
  (procurement_order). Set the procurement number in Setup > WhatsApp (respond.io).
Auto uniform orders now prefill item sizes from the employee's saved sizes.


## Training by assignment + salary breakdown on WhatsApp

- Training is no longer role-owned. For each level (Basics, Safety, Application) you assign a
  specific user; they get a WhatsApp (training_assignment) with the task, then mark it complete,
  which advances the employee to the next level. Team labels (L&D/Facility/BA) removed;
  "Application (BA)" renamed to "Application". Staff now have a WhatsApp number (Users page) used
  for these assignments.
- Salaries: "Dispatch breakdown" (per employee) and "Dispatch breakdown all" send each employee
  their monthly summary on WhatsApp (salary_breakdown: base, additions, deductions, net).


## Itemized additions/deductions in salary breakdown

The salary breakdown WhatsApp now lists each component with its amount on one line (e.g.
"Google review AED 50, Overtime AED 200") for additions and deductions, instead of just totals.
Only non-zero components are listed; "none" if empty. Update the salary_breakdown template so
{{4}} and {{5}} are plain (no "AED " prefix), since the value already includes AED per item.


## UX batch (fixes)

- Add candidate button shows "Adding…" and is disabled while saving, preventing duplicate records.
- Reject button added at the Interview stage (plain decline, no payment).
- Signed PDF in pending payments now opens via authenticated fetch (was a blank page).
- Pending payments split into Pending and Paid tabs.
- Salaries: "Pay cash" sends the net as a cash settlement to Pending payments (signature flow).
- Calendar slots in the past show as "expired" and can't be booked (server-guarded too).
- Document-processing table headers show the stage name only (removed the doc-type sub-line).
- Opening an employee profile no longer persists when switching pages/tabs.
- Removed the Lifecycle stages panel from Setup; tidied action-button rows, modal fields, tabs.

Deferred (told the user): draw-to-sign on the signature page, and a full tabbed Setup reorg.


## Draw-to-sign and Setup tabs

- Settlement signing page now has a draw-your-signature pad (mouse/touch) alongside the typed
  name. The drawn image is stored and embedded in the signed PDF; if no drawing is provided it
  falls back to the typed name.
- Setup is organised into tabs: Organisation, Salary, Uniforms & documents, Calendars, WhatsApp.


## Fix: template sends rejected (400)

respond.io's API rejects a `text` property on whatsapp_template messages
("MessageValidator: instance is not allowed to have the additional property text"), which broke
all template sends. Removed that field, restoring delivery for every template (settlement,
interview, trial, offer, documents, medical, procurement, sizes, training, salary). Trade-off:
the respond.io Inbox may again show the template row without the rendered body, but WhatsApp
delivery to the recipient is correct. Interview/trial/offer sends are now awaited and their
sent/failed result is shown as a toast.


## Chatbot API (n8n)

Thin, secret-protected endpoints for the WhatsApp chatbot (n8n AI Agent). Set env BOT_SECRET;
every call must send header `x-bot-secret: <BOT_SECRET>`. The app remains the source of truth.
- GET  /api/bot/leave?phone=+9715XXXXXXXX  -> { employee, entitlementDays, takenDays, plannedDays, remainingDays, upcoming[] }
- POST /api/bot/leave-request { phone, startDate, endDate, days?, note? } -> creates a Pending
  Vacation request in employee_requests (approved via the staff Requests page) and returns
  { requestId, days, remainingBeforeApproval, enoughBalance, status, message }.
Employees are matched by the last 9 digits of their phone. Excused (non-deductible) leave is not
counted against the balance.


## Add existing employees

HR/Admin can add an existing employee directly from the Employees page ("Add employee"),
skipping recruitment. They are created as Active (kind=employee) with name, position, city,
warehouse, salary, start date, WhatsApp number and email, and a profile row is seeded.
Candidates still only appear on the Employees page once their offer is accepted (kind becomes
employee); before that they live under Recruitment.


## Full chatbot API + referrals + reimbursements

Bot endpoints (all under /api/bot, header x-bot-secret):
Reads: /me, /leave, /contract, /salary?month=, /requests, /documents, /uniform
Writes: /leave-request, /sick-leave, /uniform-request, /update-size (direct),
        /training-request (direct, auto-approved), /refer (creates an applicant, optional cvBase64),
        /request (Other + optional attachmentBase64), /reimbursement (amount+reason+receiptBase64).
Applicants: the "Owner" column is now "Through" (referral source); referrals populate it.
Requests: approving a "Reimbursement" request auto-creates a pending payment (settlement flow).
Salary is returned to the messaging number. Month accepts YYYY-MM, "last month", or a month name.


## Portal request parity with the chatbot

The employee self-service portal now offers the same request types as the bot: Vacation, Sick
leave, Uniform, Training (logged directly, no approval), Reimbursement (amount + reason + receipt;
becomes a payment on approval), and Other (free text + optional attachment). Attachments are
accepted for sick leave, reimbursement, and other.


## Batch: leave, payroll, reject (pass 1)

- Global annual leave entitlement set in Setup > Organisation; applies to all employees.
- Sick leave and unpaid leave no longer count against the vacation balance (bot + portal).
- Reject: daily rate is auto-calculated from salary (salary / 30.416); a checkbox optionally
  WhatsApps the candidate a "not selected" notice (candidate_rejected template).
- Transfer all now transfers every non-transferred sheet for the month (was silently limited to
  'ready' only); button enables when any sheet is draft or ready.


## Batch pass 2a (profile, docs, warehouse)

- Employee profile: removed the "Personal & contact" tab; Details now lets you edit position,
  warehouse and start date (all editable in one place). Warehouse is optional (movers etc.).
- Document processing: removed the per-row document upload; removed the Document expiry page and
  its nav; the leave/vacations tracker remains (module renamed "Leave").
- Profile save now persists position (job_role), warehouse, and start date.


## Batch pass 2b (custom roles + start empty)

- Custom roles (#13): Setup > Access & roles lets an admin create roles and tick which pages each
  can access (page/module level). Roles are stored in DB and applied live; admin is protected and
  always full-access. Assign roles on the Users page. Access checks (server canSee + client nav)
  now read the dynamic roles.
- Start empty (#1): demo data is now opt-in via SEED_DEMO=true. By default only an admin login is
  ensured (admin@storage.ae) and config/roles seed; no sample candidates. A "Clear all data"
  action (Setup > Access & roles > Danger zone) wipes all people/operational records (keeping
  users, roles, config, settings), guarded by an admin check and a typed DELETE confirmation.


## Leave rules, facility, insurance, referral bonus (build)

Dashboard + API for the chatbot rules doc:
- Setup > Leave rules: annual entitlement, advance-notice days (7), movers-on-leave limit (2).
- GET /api/bot/leave-eligibility (notice + balance + approved-leave coverage by warehouse branch;
  movers use the movers group + limit). Movers detected by position containing "mover".
- POST /api/bot/leave-request now takes type (Vacation/Sick leave) + optional report; Vacation runs
  the eligibility checks and records a Rejected request with the reason when blocked, else Pending.
- POST /api/bot/facility-request: raises a Procurement order (facility category) + Closed request.
- GET /api/bot/insurance + an insurance-expiry field on the profile.
- Referral bonus: referrer stored on the referred candidate; when their offer is accepted a
  "Referral bonus" reminder request is created for the referrer (manual bonus, no amount).
- Uniform requests remain a single pending request/work order (no auto-swap branch).


## Test-round fixes (dashboard)

- Salary accepts commas (2,700) on add-employee and profile.
- Leave entitlement uses the global Setup value everywhere (was defaulting to 30).
- Demo salary components (Attendance etc.) no longer auto-seed unless SEED_DEMO=true.
- Leave & vacations table columns centered; already sorted by priority (high to low).
- Transfer all now creates+marks transferred for every employee with a salary (was a no-op).
- Facility/maintenance requests notify the procurement manager on WhatsApp.
- Training page shows only employees in Training (existing/active hires no longer listed).
- Recruitment "Owner" column replaced with "Through" (referral source).


## Accrual, teams, training work orders

- Leave accrual: available = floor(monthsWorked * entitlement / 24) - taken - planned (entitlement is a
  2-year figure). Eligibility caps requests at accrued days, not the full entitlement.
- Positions have a Team (Warehouse | Movers) set in Setup; the coverage rule uses it (Warehouse = one
  per branch on leave; Movers = shared configurable limit). Replaces the name-based mover guess.
- Chatbot training requests create a real training work order (assignment) shown under "Requested
  training sessions" on the Training page; HR assigns a trainer and marks it complete. Ad-hoc sessions
  for active employees don't advance the recruit pipeline (only new recruits do all three levels).


## Button sent-state (#11)

After clicking, the "Send request" / "Notify manager" (doc processing) and "Request sizes"
(procurement) buttons flip to a green done state ("Request sent" / "Manager notified" /
"Sizes requested") instead of staying clickable, so they aren't sent twice.


## Leave message field

POST /api/bot/leave-request now returns a ready-to-say 'message' for every outcome (Pending and
each refusal code) so the bot relays it verbatim instead of reasoning about the policy itself
(which was causing wrong refusals, e.g. rejecting a December date for 'notice').


## Self-booking + collection response + stage timing

- Adding a candidate now auto-sends a self-service interview booking link (interview_booking
  template). The candidate opens /book/:token (no login), picks an open slot; booking assigns the
  slot, moves them to Interview, and fires the same interview_candidate + interview_interviewer
  templates HR's manual scheduling sends. Manual scheduling is kept as a backup.
- The collection link (/sizes/:token) now also collects a passport copy, a digital studio photo,
  and current visa status (plus sizes). Document processing has a "View response" action showing
  the submitted data with links to open the passport/photo.
- Document processing cells show days-in-stage as small text under the in-progress icon.


## Country-code search + public page subtitle

- The phone country-code picker (add candidate / add employee) is now a searchable dropdown:
  click, type a country name / ISO / dial code, and the list filters live.
- Public pages (booking, collection) no longer show "Final settlement signature" as the subtitle;
  pageShell takes a subtitle, and only the settlement page uses that heading.


## Stage time persistence + page persistence

- Time spent in each stage now persists: on every stage advance the elapsed time is accumulated
  into candidates.stage_durations (seconds per stage). Document processing shows the kept time
  under each completed stage (e.g. 2d) and the current running time under the in-progress icon.
- The app remembers the current page across refresh (localStorage), falling back to Overview if the
  role can't access the saved page. No more bouncing to the main page on refresh.


## Collection & booking fixes

- Interview booking page shows slots from tomorrow onwards only (never today, even if time remains).
- Collection/onboarding form: all fields are mandatory (passport, photo, visa status, sizes);
  first-time submission requires the passport copy and studio photo.
- "Send request" persists: after a request is sent it shows "Resend" (and "Submitted" once the
  candidate has filled the form), even after a refresh.
- View response shows the submission date and time.


## Employees filter, numbered leave priority, collection notify

- Employees page now only lists people who have passed Medical and Tawjeeh (Visa & Emirates ID,
  Insurance registration, Training, Active) or were added manually; rejected candidates and those
  still in early documentation no longer appear.
- Leave & vacations priority is now a rank number (1 = most urgent), sorted by
  (days until contract expiry − remaining leave days) ascending.
- When a candidate submits the documents/sizes form, the manager/HR is notified on WhatsApp
  (collection_submitted template).


## Separate HR number

Setup > WhatsApp now has a distinct HR WhatsApp number (separate from the Manager number). The
collection-submitted notice goes to HR (falls back to Manager only if HR isn't set). Manager and
Procurement numbers are unchanged.


## Bonus leave, flight ticket, auto leave days

- Profile > Vacations: add/remove extra leave days (for extra days worked); the extra days add to
  the employee's available balance (dashboard + chatbot).
- Profile > Details: flight-ticket status per contract (Available/Taken) with mark taken/available
  and an attachment to keep the bought ticket on record.
- Adding a leave in the profile no longer has a Days field; days auto-calculate from start and end.


## Payslip PDF (dispatch)

Dispatch breakdown / Dispatch breakdown all now generate a branded PDF payslip (base, itemised
additions, itemised deductions, net), save it to the employee's profile documents (label
"Payslip <month>", replacing any prior one for that month), and WhatsApp the employee a link to
view it (payslip template, public /payslip/:token page). Requires PUBLIC_URL.


## Save all (salaries)

The Salaries page has a "Save all" button that saves every edited row at once (shows the count of
pending changes; enabled only when there are unsaved edits). Per-row Save is kept.


## Contracts + compensation days

- Extra leave is now recorded, not a counter: add a compensation day with the date compensated and
  a note (e.g. "worked Sunday"); it credits the current contract's balance and shows as a line item.
- Contracts: each employee has contract periods (contracts table; the first is auto-created from
  their start/contract dates). Each contract has its own flight-ticket status + attachment, shown in
  Profile > Details > Contracts & flight tickets.
- "Start new contract" closes the current one, snapshots its unused leave days, and opens a fresh
  contract that resets vacation (accrual restarts from the new start date). Closed contracts keep a
  pool of unused days you can "use a day" from or "reimburse".
- Accrual/eligibility (dashboard + chatbot) now key off the current contract's start date, counting
  only leaves within it.


## Payslip logo

The payslip PDF now shows the storage.ae logo on a dark header band (server/src/assets/logo.png),
and the footer reads "Thank you for your hard work." instead of the computer-generated notice.


## Payslip tweaks + profile resilience

- Payslip: "Base salary" renamed to "Salary"; the Pay period label/value are right-aligned to the
  amounts column.
- Accrual is capped at the entitlement (was over-accruing beyond 24 months).
- Profile GET is resilient: if contracts/compensation data can't load, the profile still opens
  (was rendering blank when those queries failed). Country flag guarded on the client.


## decline-request (auto-reject)

POST /api/bot/decline-request { phone, type, note, reason? } records an already-Rejected request
(e.g. salary raise, loan/advance) so HR has the history without having to action it. Point the
chatbot's raise tool at this endpoint. Sick-leave routes already skip the advance-notice/coverage
checks server-side; if the bot saw a notice error on sick leave, the n8n tool must pass
type:"Sick leave" to /leave-request or use /sick-leave.


## Training requests route fix

GET /api/candidates/training-requests was defined AFTER /:id, so it was shadowed (matched as
id="training-requests") and returned nothing — chatbot training requests never appeared on the
Training page. Moved it above /:id and broadened it to any employee with an incomplete assignment.


## Bot ticket status

GET /api/bot/ticket?phone= returns the current contract's flight-ticket status: available (not yet
taken, can still be used), taken (already used this contract), plus the contract period.
