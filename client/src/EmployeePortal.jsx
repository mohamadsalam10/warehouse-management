import { useEffect, useState } from "react";
import { api, getToken } from "./api.js";
import {
  Wallet, CalendarDays, MessageSquarePlus, LogOut, ChevronRight, X, Plus, FileText, Paperclip,
} from "lucide-react";

const money = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n || 0);
const initials = (n) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" }); };
const shiftMonth = (m, d) => { const [y, mo] = m.split("-").map(Number); const idx = y * 12 + (mo - 1) + d; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const statusTone = (s) => ({ Approved: "ok", Rejected: "bad", Pending: "wait", pending: "wait", ordered: "info", received: "ok" }[s] || "wait");

export default function EmployeePortal({ employee, logout }) {
  const [tab, setTab] = useState("salary");
  const [showRequest, setShowRequest] = useState(false);
  const tabs = [
    ["salary", "Pay", Wallet], ["leave", "Time off", CalendarDays], ["documents", "Docs", FileText], ["requests", "Requests", MessageSquarePlus],
  ];
  return (
    <div className="ep">
      <header className="ep-top">
        <div className="ep-me"><span className="ep-ava">{initials(employee.name)}</span>
          <div><div className="ep-name">{employee.name}</div><div className="ep-role">{employee.position} · {employee.warehouse}</div></div>
        </div>
        <button className="ep-logout" onClick={logout}><LogOut size={18} /></button>
      </header>

      <main className="ep-main">
        {tab === "salary" && <SalaryTab />}
        {tab === "leave" && <LeaveTab />}
        {tab === "documents" && <DocumentsTab />}
        {tab === "requests" && <RequestsTab onNew={() => setShowRequest(true)} />}
      </main>

      <nav className="ep-nav">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} className={"ep-navbtn" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {showRequest && <RequestModal onClose={() => setShowRequest(false)} onDone={() => { setShowRequest(false); setTab("requests"); }} />}
    </div>
  );
}

function DocumentsTab() {
  const [docs, setDocs] = useState(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  function load() { api.get("/portal/documents").then(setDocs).catch(() => {}); }
  useEffect(load, []);
  async function open(d) {
    const res = await fetch(`/api/portal/documents/${d.id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank");
  }
  async function upload() {
    setErr(""); if (!label || !file) { setErr("Add a name and choose a file"); return; }
    setBusy(true);
    try { const fd = new FormData(); fd.append("label", label); fd.append("expiry", expiry); fd.append("file", file); await api.postForm("/portal/documents", fd); setLabel(""); setExpiry(""); setFile(null); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del(id) { try { await api.del(`/portal/documents/${id}`); load(); } catch (e) { setErr(e.message); } }
  return (
    <div className="ep-stack">
      <Card>
        <div className="ep-card-h">Upload a document</div>
        {err && <div className="login-err">{err}</div>}
        <label className="ep-field"><span>Document name</span><input placeholder="e.g. Emirates ID, Passport" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="ep-field"><span>Expiry date (optional)</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
        <label className="ep-field"><span>File</span><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <button className="ep-primary" disabled={busy} onClick={upload}>{busy ? "Uploading" : "Upload document"}</button>
      </Card>
      <Card>
        <div className="ep-card-h">Your documents</div>
        {!docs ? <Loading /> : docs.length === 0 ? <Empty>No documents yet.</Empty> : docs.map((d) => (
          <div className="ep-row" key={d.id}>
            <button className="ep-doc-open" onClick={() => open(d)}><Paperclip size={16} /><div><div className="ep-row-t">{d.label}</div><div className="ep-row-s">{d.filename}{d.expiry ? ` · expires ${d.expiry}` : ""}</div></div></button>
            {d.mine && <button className="ep-doc-del" onClick={() => del(d.id)}><X size={16} /></button>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function Card({ children, className = "" }) { return <div className={"ep-card " + className}>{children}</div>; }
function Loading() { return <div className="ep-empty">Loading</div>; }
function Empty({ children }) { return <div className="ep-empty">{children}</div>; }
function Badge({ tone, children }) { return <span className={"ep-badge t-" + tone}>{children}</span>; }

function SalaryTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`/portal/salary?month=${month}`).then(setData).catch(() => {}); }, [month]);
  return (
    <div className="ep-stack">
      <div className="ep-monthnav">
        <button onClick={() => setMonth(shiftMonth(month, -1))}><ChevronRight size={18} style={{ transform: "rotate(180deg)" }} /></button>
        <span>{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
      </div>
      {!data ? <Loading /> : (
        <Card>
          <div className="ep-line"><span>Base salary</span><span className="ep-amt">AED {money(data.base)}</span></div>
          {data.components.map((c) => (
            <div className="ep-line" key={c.name}><span>{c.name}{c.kind === "deduction" ? " (deduction)" : ""}</span><span className={"ep-amt" + (c.kind === "deduction" ? " ep-neg" : "")}>{c.kind === "deduction" ? "− " : ""}AED {money(c.amount)}</span></div>
          ))}
          <div className="ep-line ep-total"><span>Total</span><span className="ep-amt">AED {money(data.total)}</span></div>
          <div className="ep-status-row">Status <Badge tone={statusTone(data.status)}>{data.status}</Badge></div>
        </Card>
      )}
      <div className="ep-fineprint">Pay is set by your manager and released by accounts. Amounts show for the selected month.</div>
    </div>
  );
}

function LeaveTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/portal/leave").then(setData).catch(() => {}); }, []);
  if (!data) return <Loading />;
  return (
    <div className="ep-stack">
      <div className="ep-grid3">
        <Card className="ep-stat"><div className="ep-stat-v">{data.entitlement}</div><div className="ep-stat-k">Entitlement</div></Card>
        <Card className="ep-stat"><div className="ep-stat-v">{data.taken}</div><div className="ep-stat-k">Taken</div></Card>
        <Card className="ep-stat"><div className="ep-stat-v accent">{data.remaining}</div><div className="ep-stat-k">Remaining</div></Card>
      </div>
      <div className="ep-fineprint">Added {data.bonus || 0} days · Planned {data.planned || 0} days</div>
      <Card>
        <div className="ep-card-h">Leave history</div>
        {data.leaves.length === 0 ? <Empty>No leave recorded.</Empty> : data.leaves.map((l) => (
          <div className="ep-row" key={l.id}>
            <div><div className="ep-row-t">{l.type} · {l.days}d{l.deductible === false ? " · excused" : ""}</div><div className="ep-row-s">{l.startDate || "-"}{l.endDate ? ` to ${l.endDate}` : ""}</div></div>
            <Badge tone={l.deductible === false ? "info" : l.status === "Taken" ? "ok" : "info"}>{l.deductible === false ? "Excused" : l.status}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}

function RequestsTab({ onNew }) {
  const [reqs, setReqs] = useState(null);
  function load() { api.get("/portal/requests").then(setReqs).catch(() => {}); }
  useEffect(load, []);
  return (
    <div className="ep-stack">
      <button className="ep-primary" onClick={onNew}><Plus size={18} /> New request</button>
      {!reqs ? <Loading /> : reqs.length === 0 ? <Empty>You have not made any requests.</Empty> : reqs.map((r) => (
        <Card key={r.id}>
          <div className="ep-card-h ep-flex"><span>{r.type}</span><Badge tone={statusTone(r.status)}>{r.status}</Badge></div>
          {(r.type === "Vacation" || r.type === "Sick leave") && <div className="ep-row-s">{r.days}d{r.startDate ? ` · ${r.startDate}${r.endDate ? ` to ${r.endDate}` : ""}` : ""}</div>}
          {r.type === "Uniform" && <div className="ep-row-s">{r.item}{r.size ? ` · ${r.size}` : ""} · ×{r.quantity || 1}</div>}
          {r.type === "Reimbursement" && <div className="ep-row-s">AED {r.amount} · {r.note || ""}</div>}
          {r.type === "Training" && <div className="ep-row-s">{r.note || "Extra session"}</div>}
          {r.hasReport && <div className="ep-row-s">Medical report attached</div>}
          {r.type === "Sick leave" && r.status === "Approved" && <div className="ep-row-s" style={{ color: r.reportApproved ? "var(--success)" : "var(--warning)" }}>{r.reportApproved ? "Excused — not deducted from your leave" : "Deducted from your leave"}</div>}
          {r.note && <div className="ep-row-note">“{r.note}”</div>}
          {r.decisionNote && <div className="ep-row-s">Note: {r.decisionNote}</div>}
        </Card>
      ))}
    </div>
  );
}

function RequestModal({ onClose, onDone }) {
  const [type, setType] = useState("Vacation");
  const [items, setItems] = useState([]);
  const [f, setF] = useState({ startDate: "", endDate: "", days: "", item: "", size: "", quantity: 1, amount: "", note: "" });
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const isLeave = type === "Vacation" || type === "Sick leave";
  const canAttach = type === "Sick leave" || type === "Reimbursement" || type === "Other";
  const leaveDays = (isLeave && f.startDate && f.endDate) ? Math.max(0, Math.round((new Date(f.endDate) - new Date(f.startDate)) / 86400000) + 1) : "";
  useEffect(() => { api.get("/portal/meta").then((d) => { const it = d.uniformItems || []; setItems(it); setF((s) => ({ ...s, item: it[0] || "" })); }).catch(() => {}); }, []);
  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (isLeave && (!f.startDate || !f.endDate)) { setErr("Choose both a from and to date"); setBusy(false); return; }
      if (type === "Reimbursement" && (!f.amount || Number(f.amount) <= 0)) { setErr("Enter the amount"); setBusy(false); return; }
      if (type === "Reimbursement" && !f.note.trim()) { setErr("Add a reason"); setBusy(false); return; }
      const days = isLeave ? leaveDays : f.days;
      if (canAttach && report) {
        const fd = new FormData();
        fd.append("type", type); fd.append("days", days || ""); fd.append("startDate", f.startDate); fd.append("endDate", f.endDate);
        fd.append("amount", f.amount || ""); fd.append("item", f.item || ""); fd.append("size", f.size || ""); fd.append("quantity", f.quantity || "");
        fd.append("note", f.note); fd.append("report", report);
        await api.postForm("/portal/requests", fd);
      } else {
        await api.post("/portal/requests", { type, ...f, days });
      }
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="ep-scrim" onClick={onClose} />
      <div className="ep-sheet">
        <div className="ep-sheet-h"><h3>New request</h3><button onClick={onClose}><X size={20} /></button></div>
        {err && <div className="login-err">{err}</div>}
        <label className="ep-field"><span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}><option>Vacation</option><option>Sick leave</option><option>Uniform</option><option>Training</option><option>Reimbursement</option><option>Other</option></select>
        </label>
        {type === "Training" && <div className="ep-days-calc">An extra training session is logged straight away, no approval needed.<span className="ep-hint"> Use the note for the level or topic.</span></div>}
        {isLeave && (<>
          <div className="ep-grid2">
            <label className="ep-field"><span>From</span><input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label className="ep-field"><span>To</span><input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></label>
          </div>
          <div className="ep-days-calc">{leaveDays !== "" ? `${leaveDays} day${leaveDays === 1 ? "" : "s"}` : "Pick both dates"}<span className="ep-hint"> · calculated from the dates</span></div>
        </>)}
        {type === "Reimbursement" && (
          <label className="ep-field"><span>Amount (AED)</span><input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="e.g. 120" /></label>
        )}
        {type === "Uniform" && (<>
          <label className="ep-field"><span>Item</span>
            {items.length ? <select value={f.item} onChange={(e) => set("item", e.target.value)}>{items.map((i) => <option key={i}>{i}</option>)}</select>
              : <input placeholder="T-shirt, pants, shoes…" value={f.item} onChange={(e) => set("item", e.target.value)} />}
          </label>
          <div className="ep-grid2">
            <label className="ep-field"><span>Size</span><input value={f.size} onChange={(e) => set("size", e.target.value)} /></label>
            <label className="ep-field"><span>Quantity</span><input inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></label>
          </div>
        </>)}
        <label className="ep-field"><span>{type === "Reimbursement" ? "Reason" : "Note"}{type === "Reimbursement" ? "" : " (optional)"}</span><textarea rows={3} value={f.note} onChange={(e) => set("note", e.target.value)} /></label>
        {canAttach && (
          <label className="ep-field"><span>{type === "Sick leave" ? "Medical report" : type === "Reimbursement" ? "Receipt" : "Attachment"} (optional)</span>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setReport(e.target.files[0] || null)} />
            {type === "Sick leave" && <span className="ep-hint">If approved, these days won't be deducted from your leave.</span>}
            {type === "Reimbursement" && <span className="ep-hint">Once approved by HR this becomes a payment.</span>}
          </label>
        )}
        <button className="ep-primary" disabled={busy} onClick={submit}>{busy ? "Sending" : "Submit request"}</button>
      </div>
    </>
  );
}
