import { createContext, useContext, useEffect, useMemo, useState, useRef } from "react";
import {
  LayoutDashboard, UserPlus, Users, FileText, ClipboardCheck, GraduationCap,
  Warehouse, Search, Bell, ChevronDown, ChevronRight, Plus, ArrowRight, X,
  MapPin, CheckCircle2, Circle, Clock, MessageCircle, PanelLeft, Package,
  ShieldCheck, LogOut, Lock, Trash2, Paperclip, UserCog, SlidersHorizontal, MessageSquarePlus,
  CalendarClock, CheckSquare, Wallet, CalendarDays, Ban, Check, BellRing, Inbox,
} from "lucide-react";
import { useAuth } from "./auth.jsx";
import { api, getToken } from "./api.js";
import Login from "./components/Login.jsx";
import EmployeePortal from "./EmployeePortal.jsx";
import { COUNTRY_CODES } from "./countryCodes.js";

const MetaCtx = createContext(null);
const useMeta = () => useContext(MetaCtx);

// Searchable country-code picker: click to open, type to filter by name/code/dial.
function CountryCodeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);
  const sel = COUNTRY_CODES.find((c) => c.iso === value) || COUNTRY_CODES[0];
  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQ(""); } }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const term = q.trim().toLowerCase();
  const list = term
    ? COUNTRY_CODES.filter((c) => c.name.toLowerCase().includes(term) || c.iso.toLowerCase().includes(term) || String(c.dial).includes(term))
    : COUNTRY_CODES;
  return (
    <div className="cc-wrap" ref={wrapRef}>
      <button type="button" className="cc-select" onClick={() => setOpen((o) => !o)}>
        {sel ? `${sel.iso} ${sel.dial}` : "Select"}<ChevronDown size={13} style={{ marginLeft: 4 }} />
      </button>
      {open && (
        <div className="cc-pop">
          <input className="cc-search" autoFocus placeholder="Search country or code…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="cc-list">
            {list.map((c) => (
              <button type="button" key={c.iso} className={"cc-opt" + (c.iso === value ? " on" : "")}
                onClick={() => { onChange(c.iso); setOpen(false); setQ(""); }}>
                <span>{c.name}</span><span className="cc-dial">{c.dial}</span>
              </button>
            ))}
            {list.length === 0 && <div className="cc-none">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}


const OWNERS = {
  HR: "#004fe5", You: "#0a0a0a", "Ops lead": "#fe5000", PRO: "#d97706",
  BA: "#1f8a4d", "L&D": "#004fe5", Facility: "#7688a2", Procurement: "#7688a2", Accountant: "#7688a2",
};

const NAV = [
  { type: "page", id: "overview", label: "Overview", icon: LayoutDashboard },
  {
    type: "module", id: "recruitment", label: "Recruitment", icon: UserPlus,
    pages: [
      { id: "applicants", label: "Applicants" },
      { id: "shortlist", label: "Shortlist" },
      { id: "interviews", label: "Interviews" },
      { id: "trials", label: "Trials" },
      { id: "offers", label: "Offers" },
      { id: "rejected", label: "Rejected" },
    ],
  },
  { type: "module", id: "documentation", label: "Document processing", icon: FileText, pages: [{ id: "documents", label: "Document processing" }] },
  { type: "calendar-placeholder" },
  { type: "module", id: "procurement", label: "Procurement", icon: Package, pages: [{ id: "procurement", label: "Uniform orders" }] },
  { type: "module", id: "training", label: "Training", icon: GraduationCap, pages: [{ id: "matrix", label: "Training matrix" }] },
  { type: "module", id: "accounting", label: "Accounting", icon: Wallet, pages: [{ id: "salaries", label: "Salaries" }, { id: "pending-payments", label: "Pending payments" }] },
  { type: "page", id: "employees", label: "Employees", icon: Users },
  { type: "page", id: "requests", label: "Requests", icon: Inbox },
  { type: "module", id: "leave", label: "Leave", icon: BellRing, pages: [{ id: "leave-tracker", label: "Leave & vacations" }] },
  { type: "page", id: "users", label: "Users", icon: UserCog },
  { type: "page", id: "setup", label: "Setup", icon: SlidersHorizontal },
];

const PAGE_TITLES = {
  overview: ["Network", "Warehouses"],
  applicants: ["Recruitment", "Applicants"], interviews: ["Recruitment", "Interviews"],
  shortlist: ["Recruitment", "Shortlist"], rejected: ["Recruitment", "Rejected"],
  trials: ["Recruitment", "Trials"], offers: ["Recruitment", "Offers"],
  documents: ["Document processing", "Document processing"], assignment: ["Onboarding", "Uniform & assignment"],
  procurement: ["Procurement", "Uniform orders"], matrix: ["Training", "Training matrix"],
  calendar: ["Recruitment", "Interview calendar"],
  salaries: ["Accounting", "Salaries"], "pending-payments": ["Accounting", "Pending payments"],
  employees: ["Directory", "Employees"], warehouses: ["Network", "Warehouses"],
  requests: ["Employee portal", "Requests"],
  "leave-tracker": ["Leave", "Leave & vacations"],
  users: ["Administration", "Users & access"], setup: ["Administration", "Setup"],
};

const PHASE_LABEL = { Documentation: "Document processing" };
const labelPhase = (p) => PHASE_LABEL[p] || p;
const initials = (n) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const health = (d) => (d >= 6 ? "danger" : d >= 3 ? "warning" : "success");
const canSee = (meta, role, page) => { const r = meta.roles[role]; return r && (r.pages === "*" || r.pages.includes(page)); };
const citiesFor = (meta, country) => meta.cities.filter((c) => c.country === country).map((c) => c.name);
const warehousesFor = (meta, city) => meta.warehouses.filter((w) => w.city === city).map((w) => w.name);
function lifecycle(meta, country) { return meta.phases.map((p) => ({ ...p })); }
function flatStages(meta, country) {
  const flat = [];
  lifecycle(meta, country).forEach((p) => p.stages.forEach((s) => flat.push({ phase: p.key, stage: s })));
  return flat;
}
function queueTarget(role) {
  const map = {
    admin: { page: "interviews", label: "Review interviews" }, hr: { page: "applicants", label: "Open recruitment" },
    pro: { page: "documents", label: "Open documents" }, procurement: { page: "procurement", label: "Open kit orders" },
    facility: { page: "matrix", label: "Open training" }, ld: { page: "matrix", label: "Open training" }, ba: { page: "matrix", label: "Open training" },
  };
  return map[role] || null;
}

export default function App() {
  const { principal, ready, logout } = useAuth();
  const [meta, setMeta] = useState(null);
  const isEmployee = principal && principal.kind === "employee";
  useEffect(() => { if (principal && !isEmployee) api.get("/meta").then(setMeta).catch(() => {}); }, [principal]);
  if (!ready) return <div className="splash">Loading</div>;
  if (!principal) return <Login />;
  if (isEmployee) return <EmployeePortal employee={principal} logout={logout} />;
  if (!meta) return <div className="splash">Loading workspace</div>;
  return (
    <MetaCtx.Provider value={meta}>
      <Dashboard user={principal} logout={logout} refreshMeta={() => api.get("/meta").then(setMeta)} />
    </MetaCtx.Provider>
  );
}

function Dashboard({ user, logout, refreshMeta }) {
  const meta = useMeta();
  const role = user.role;
  const [country, setCountry] = useState("UAE");
  const cityList = citiesFor(meta, country);
  const [city, setCity] = useState(cityList[0] || "Dubai");
  const [page, setPage] = useState(() => { try { return localStorage.getItem("sa_page") || "overview"; } catch { return "overview"; } });
  useEffect(() => { try { localStorage.setItem("sa_page", page); } catch {} }, [page]);
  useEffect(() => { if (meta && role && page !== "overview" && !canSee(meta, role, page)) setPage("overview"); }, [meta, role]);
  const [openModules, setOpenModules] = useState({ recruitment: true });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [userMenu, setUserMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [calendars, setCalendars] = useState([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [scheduleFor, setScheduleFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [trialFor, setTrialFor] = useState(null);
  const [offerFor, setOfferFor] = useState(null);
  const [shortlistFor, setShortlistFor] = useState(null);
  const [rejectOfferFor, setRejectOfferFor] = useState(null);
  const [declineFor, setDeclineFor] = useState(null);
  const [profileId, setProfileId] = useState(null);
  useEffect(() => { setProfileId(null); setSelected(null); }, [page]);
  const openProfile = (id) => { setSelected(null); setProfileId(id); };

  useEffect(() => { api.get("/calendars").then(setCalendars).catch(() => {}); }, []);
  const ownsCalendar = calendars.some((c) => c.mine);
  const calPageIds = calendars.map((c) => `cal-${c.id}`);
  const seePage = (p) => {
    if (p && p.startsWith("cal-")) return calPageIds.includes(p);
    return canSee(meta, role, p);
  };
  const rejectable = ["Trial", "Basics", "Safety", "Application"];
  const canRejectStage = (stage) => rejectable.includes(stage) && (role === "admin" || role === "hr" || meta.stageOwner[stage] === meta.roles[role].owner);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(""), 3400); }
  function refresh() {
    setLoading(true);
    api.get(`/candidates?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}`)
      .then(setRoster).catch((e) => notify(e.message)).finally(() => setLoading(false));
  }
  useEffect(refresh, [country, city]);

  function switchCountry(k) { setCountry(k); setCity(citiesFor(meta, k)[0] || ""); setSelected(null); }

  function waToast(res, label) {
    const wa = res && res._whatsapp;
    if (!wa) return;
    const parts = [];
    for (const k of Object.keys(wa)) { const d = wa[k]; if (!d) continue; parts.push(d.sent ? `${k} sent` : `${k} not sent${d.error ? ` (${d.error})` : ""}`); }
    if (parts.length) notify(`${label}: ${parts.join(", ")}`);
  }
  const act = (fn) => async (id) => { try { await fn(id); refresh(); if (selected?.id === id) reopen(id); } catch (e) { notify(e.message); } };
  const advance = act((id) => api.post(`/candidates/${id}/advance`));
  const acceptOffer = act((id) => api.post(`/candidates/${id}/accept-offer`));
  const openSchedule = (id) => setScheduleFor(roster.find((c) => c.id === id) || { id });
  const openReject = (id) => setRejectFor(roster.find((c) => c.id === id) || { id });
  const openTrial = (id) => setTrialFor(roster.find((c) => c.id === id) || { id });
  const openOffer = (id, edit) => { const c = roster.find((x) => x.id === id) || { id }; setOfferFor({ ...c, _edit: !!edit }); };
  const openShortlist = (id) => setShortlistFor(roster.find((c) => c.id === id) || { id });
  const openRejectOffer = (id) => setRejectOfferFor(roster.find((c) => c.id === id) || { id });
  const openDecline = (id) => setDeclineFor(roster.find((c) => c.id === id) || { id });
  async function doDecline(id, reason) { try { await api.post(`/candidates/${id}/decline`, { reason }); setDeclineFor(null); refresh(); if (selected?.id === id) setSelected(null); notify("Candidate declined"); } catch (e) { notify(e.message); } }
  async function doShortlist(id, notes) { try { await api.post(`/candidates/${id}/shortlist`, { notes }); setShortlistFor(null); refresh(); if (selected?.id === id) reopen(id); notify("Shortlisted"); } catch (e) { notify(e.message); } }
  async function doTrial(id, data) { try { const r = await api.post(`/candidates/${id}/trial`, data); setTrialFor(null); refresh(); if (selected?.id === id) reopen(id); notify("Moved to trial"); waToast(r, "Candidate WhatsApp"); } catch (e) { notify(e.message); } }
  async function doOffer(id, data, edit) { try { const r = await api[edit ? "put" : "post"](`/candidates/${id}/offer`, data); setOfferFor(null); refresh(); if (selected?.id === id) reopen(id); notify(edit ? "Offer updated" : "Offer made"); waToast(r, "Candidate WhatsApp"); } catch (e) { notify(e.message); } }
  async function doRejectOffer(id, reason) { try { await api.post(`/candidates/${id}/reject-offer`, { reason }); setRejectOfferFor(null); refresh(); if (selected?.id === id) setSelected(null); notify("Offer rejected"); } catch (e) { notify(e.message); } }
  async function downloadOffer(id) {
    try {
      const res = await fetch(`/api/candidates/${id}/offer-letter.pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { notify("Could not generate letter"); return; }
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch { notify("Could not open letter"); }
  }
  async function doSchedule(id, slotId) {
    try { const r = await api.post(`/candidates/${id}/schedule`, slotId ? { slotId } : {}); setScheduleFor(null); refresh(); if (selected?.id === id) reopen(id); notify("Interview scheduled"); waToast(r, "WhatsApp"); }
    catch (e) { notify(e.message); }
  }
  async function doReject(id, body) {
    try { const r = await api.post(`/candidates/${id}/reject`, body); setRejectFor(null); refresh(); if (selected?.id === id) setSelected(null); notify("Marked rejected, payment logged"); if (body.notify) { const d = r && r._whatsapp && r._whatsapp.candidate; notify(d ? (d.sent ? "Candidate notified on WhatsApp" : `Notice not sent: ${d.error || "no number"}`) : "No number to notify"); } }
    catch (e) { notify(e.message); }
  }
  const cycleKit = async (id, item) => { try { await api.post(`/candidates/${id}/kit`, { item }); refresh(); } catch (e) { notify(e.message); } };
  async function reopen(id) { try { setSelected(await api.get(`/candidates/${id}`)); } catch { /* ignore */ } }
  async function openDrawer(id) { try { setSelected(await api.get(`/candidates/${id}`)); } catch (e) { notify(e.message); } }
  async function remove(id, name) {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    try { await api.del(`/candidates/${id}`); if (selected?.id === id) setSelected(null); refresh(); notify(`${name} deleted`); }
    catch (e) { notify(e.message); }
  }
  async function addCandidate(form) {
    const fd = new FormData();
    fd.append("name", form.name); fd.append("position", form.position);
    fd.append("country", country); fd.append("city", city);
    if (form.phone) fd.append("phone", form.phone);
    if (form.cv) fd.append("cv", form.cv);
    try { await api.postForm("/candidates", fd); refresh(); notify("Candidate added, pending interview"); return true; }
    catch (e) { notify(e.message); return false; }
  }
  async function openCv(id) {
    try {
      const res = await fetch(`/api/candidates/${id}/cv`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { notify("No CV on file"); return; }
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch { notify("Could not open CV"); }
  }
  const canDelete = (kind) => role === "admin" || (role === "hr" && kind === "candidate");

  const visibleNav = useMemo(() => {
    const items = [];
    for (const item of NAV) {
      if (item.type === "calendar-placeholder") {
        if (calendars.length) items.push({ type: "module", id: "calendar", label: "Interview calendar", icon: CalendarDays, pages: calendars.map((c) => ({ id: `cal-${c.id}`, label: c.mine ? `${c.name} (you)` : c.name })) });
        continue;
      }
      if (item.type === "page") { if (seePage(item.id)) items.push(item); }
      else { const pages = item.pages.filter((p) => seePage(p.id)); if (pages.length) items.push({ ...item, pages }); }
    }
    return items;
  }, [meta, role, calendars]);

  const scope = roster;
  const searched = useMemo(() => {
    if (!query) return scope;
    const q = query.toLowerCase();
    return scope.filter((c) => `${c.name} ${c.role} ${c.code}`.toLowerCase().includes(q));
  }, [scope, query]);
  const employees = useMemo(() => {
    const POST_MEDICAL = ["Visa and Emirates ID", "Insurance registration"];
    return searched.filter((c) => c.kind === "employee" && c.phase !== "Rejected" &&
      (c.phase === "Active" || c.phase === "Training" || (c.phase === "Documentation" && POST_MEDICAL.includes(c.stage))));
  }, [searched]);
  // Everyone currently going through Documentation (Documents Collection -> ... -> Insurance registration),
  // including candidates who just had their offer accepted. `employees` above is intentionally narrower
  // (post-medical only) for Training/Employees/Procurement, but the Document processing page needs the
  // full Documentation-phase roster or freshly-converted employees never appear there.
  const documentationRows = useMemo(() => searched.filter((c) => c.kind === "employee" && c.phase === "Documentation"), [searched]);

  const kpis = useMemo(() => {
    const by = (ph) => scope.filter((c) => c.phase === ph).length;
    return {
      pipeline: scope.filter((c) => c.phase !== "Active").length,
      stuck: scope.filter((c) => c.phase !== "Active" && health(c.days) === "danger").length,
      active: by("Active"), Recruitment: by("Recruitment"), Documentation: by("Documentation"),
      Onboarding: by("Onboarding"), Training: by("Training"),
    };
  }, [scope]);

  let [eyebrow, title] = PAGE_TITLES[page] || ["", page];
  if (page.startsWith("cal-")) { const c = calendars.find((x) => `cal-${x.id}` === page); eyebrow = "Interview calendar"; title = c ? c.name : "Calendar"; }

  return (
    <div className={"sae" + (collapsed ? " is-collapsed" : "")}>
      <aside className="side">
        <div className="side-top">
          <div className="logo" title="storage.ae"><span className="logo-sq" />{!collapsed && <span className="logo-word">storage.ae</span>}</div>
          <button className="collapse" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar"><PanelLeft size={17} /></button>
        </div>
        <nav className="nav">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            if (item.type === "page") {
              const on = page === item.id;
              return (
                <button key={item.id} className={"nav-link" + (on ? " on" : "")} onClick={() => setPage(item.id)} title={item.label}>
                  <span className="nav-marker" /><Icon size={18} className="nav-ico" /><span className="nav-text">{item.label}</span>
                </button>
              );
            }
            const isOpen = openModules[item.id];
            const childActive = item.pages.some((p) => p.id === page);
            return (
              <div key={item.id} className="nav-mod">
                <button className={"nav-link nav-modhead" + (childActive ? " parent-on" : "")} onClick={() => setOpenModules((m) => ({ ...m, [item.id]: !m[item.id] }))} title={item.label}>
                  <span className="nav-marker" /><Icon size={18} className="nav-ico" /><span className="nav-text">{item.label}</span>
                  {isOpen ? <ChevronDown size={15} className="nav-caret" /> : <ChevronRight size={15} className="nav-caret" />}
                </button>
                {isOpen && !collapsed && (
                  <div className="nav-pages">
                    {item.pages.map((p) => (
                      <button key={p.id} className={"nav-page" + (page === p.id ? " on" : "")} onClick={() => setPage(p.id)}><span className="nav-dot" />{p.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="role-chip"><ShieldCheck size={14} /><span className="nav-text">{meta.roles[role]?.label || role}</span></div>
          <div className="lic">UAE licence 586077</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="tb-title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>
          <div className="tb-controls">
            <div className="loc">
              <MapPin size={15} />
              <select value={country} onChange={(e) => switchCountry(e.target.value)}>
                {Object.entries(meta.countries).map(([k, v]) => <option key={k} value={k}>{v.flag} {k}</option>)}
              </select>
              <span className="loc-sep" />
              <select value={city} onChange={(e) => { setCity(e.target.value); setSelected(null); }}>
                {citiesFor(meta, country).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="search"><Search size={16} /><input placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <button className="icon-btn" aria-label="Notifications"><Bell size={18} /></button>
            <div className="usermenu">
              <button className="user-btn" onClick={() => setUserMenu((v) => !v)}>
                <span className="user-ava">{initials(user.name)}</span><span className="user-name">{user.name.split(" ")[0]}</span><ChevronDown size={14} />
              </button>
              {userMenu && (
                <>
                  <div className="menu-scrim" onClick={() => setUserMenu(false)} />
                  <div className="user-drop">
                    <div className="ud-head"><div className="ud-name">{user.name}</div><div className="ud-mail">{user.email}</div></div>
                    <button onClick={logout}><LogOut size={16} /> Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          {profileId ? <ProfilePage employeeId={profileId} role={role} notify={notify} onBack={() => setProfileId(null)} />
            : loading ? <div className="empty">Loading</div> : !seePage(page) ? <NoAccess role={role} /> : (
            <>
              {page === "overview" && <WarehousesPage scope={scope} />}
              {page === "applicants" && <ApplicantsPage rows={searched} onOpen={openDrawer} onSchedule={openSchedule} onShortlist={openShortlist} onAdd={addCandidate} onDelete={remove} canDelete={canDelete} onCv={openCv} />}
              {page === "shortlist" && <ShortlistPage rows={searched} onOpen={openDrawer} onSchedule={openSchedule} onDelete={remove} canDelete={canDelete} onCv={openCv} />}
              {["interviews", "trials", "offers"].includes(page) && <RecruitmentStagePage page={page} rows={searched} onOpen={openDrawer} onDecline={openDecline} onTrial={openTrial} onOffer={openOffer} onAccept={acceptOffer} onUpdateOffer={(id) => openOffer(id, true)} onRejectOffer={openRejectOffer} onDownloadOffer={downloadOffer} onReject={openReject} onShortlist={openShortlist} canReject={canRejectStage} onDelete={remove} canDelete={canDelete} onCv={openCv} />}
              {page === "rejected" && <RejectedPage rows={searched} onOpen={openDrawer} onDelete={remove} canDelete={canDelete} />}
              {page === "documents" && <DocumentsPage rows={documentationRows} country={country} onOpen={openDrawer} onAdvance={advance} onDecline={openDecline} notify={notify} />}
              {page === "procurement" && <ProcurementPage employees={employees} country={country} city={city} role={role} notify={notify} onOpen={openProfile} />}
              {page === "matrix" && <TrainingPage rows={employees} onOpen={openDrawer} onReject={openReject} canReject={canRejectStage} role={role} refresh={refresh} notify={notify} />}
              {page === "employees" && <EmployeesPage rows={employees} country={country} onOpen={openProfile} onDelete={remove} canDelete={role === "admin"} canAdd={role === "admin" || role === "hr"} onAdd={async (data) => { await api.post("/candidates/employee", data); refresh(); notify("Employee added"); }} />}
              {page === "requests" && <RequestsPage country={country} city={city} role={role} notify={notify} onOpen={openProfile} />}
              {page === "leave-tracker" && <LeaveTrackerPage country={country} city={city} notify={notify} onOpen={openProfile} />}
              {page.startsWith("cal-") && <CalendarView key={page} calendarId={Number(page.slice(4))} calendars={calendars} role={role} notify={notify} onOpenCandidate={openDrawer} />}
              {page === "salaries" && <SalariesPage month={month} setMonth={setMonth} country={country} city={city} role={role} notify={notify} />}
              {page === "pending-payments" && <PendingPaymentsPage country={country} city={city} role={role} notify={notify} />}
              {page === "users" && <UsersPage notify={notify} />}
              {page === "setup" && <SetupPage notify={notify} refreshMeta={refreshMeta} />}
            </>
          )}
        </main>
      </div>

      {selected && <Drawer c={selected} country={country} role={role} onClose={() => setSelected(null)}
        onAdvance={advance} onSchedule={openSchedule} onShortlist={openShortlist} onAccept={acceptOffer}
        onTrial={openTrial} onOffer={openOffer} onUpdateOffer={(id) => openOffer(id, true)} onRejectOffer={openRejectOffer} onDownloadOffer={downloadOffer}
        onDecline={openDecline}
        onReject={openReject} canReject={canRejectStage(selected.stage)}
        onProfile={openProfile}
        onDelete={remove} canDelete={canDelete(selected.kind)} onCv={openCv} />}

      {scheduleFor && <ScheduleModal candidate={scheduleFor} onClose={() => setScheduleFor(null)} onConfirm={doSchedule} notify={notify} />}
      {rejectFor && <RejectModal candidate={rejectFor} onClose={() => setRejectFor(null)} onConfirm={doReject} />}
      {trialFor && <TrialModal candidate={trialFor} country={country} onClose={() => setTrialFor(null)} onConfirm={doTrial} />}
      {offerFor && <OfferModal candidate={offerFor} country={country} edit={offerFor._edit} onClose={() => setOfferFor(null)} onConfirm={doOffer} />}
      {shortlistFor && <ShortlistModal candidate={shortlistFor} onClose={() => setShortlistFor(null)} onConfirm={doShortlist} />}
      {rejectOfferFor && <ReasonModal title="Reject offer" candidate={rejectOfferFor} onClose={() => setRejectOfferFor(null)} onConfirm={doRejectOffer} />}
      {declineFor && <ReasonModal title="Reject" candidate={declineFor} onClose={() => setDeclineFor(null)} onConfirm={doDecline} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* shared bits */
function Badge({ tone = "neutral", children }) { return <span className={"badge b-" + tone}>{children}</span>; }
function PhaseTag({ phase }) {
  const map = { Recruitment: "neutral", Documentation: "warning", Onboarding: "info", Training: "success", Active: "orange" };
  return <Badge tone={map[phase] || "neutral"}>{labelPhase(phase)}</Badge>;
}
function Owner({ who }) { return <span className="owner" style={{ "--oc": OWNERS[who] || "#7688a2" }}>{who}</span>; }
function DaysCell({ d }) { return <span className={"days d-" + health(d)}>{d}d</span>; }
function Avatar({ name, sm }) { return <span className={"avatar" + (sm ? " avatar-sm" : "")}>{initials(name)}</span>; }
function Empty({ children }) { return <div className="empty">{children}</div>; }
function Stat({ label, value, note, accent, danger }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className={"stat-val" + (accent ? " accent" : "") + (danger ? " danger" : "")}>{value}</div><div className="stat-note">{note}</div></div>;
}
function IconDelete({ onClick }) { return <button className="trash" title="Delete" onClick={onClick}><Trash2 size={15} /></button>; }

/* Overview */
function Overview({ kpis, scope, country, city, role, onOpen, goto }) {
  const meta = useMeta();
  const r = meta.roles[role];
  const SO = meta.stageOwner, KIT = meta.kitItems;
  const isAdmin = role === "admin", isProc = role === "procurement";
  const queue = isProc
    ? scope.filter((c) => (c.phase === "Onboarding" || c.phase === "Training") && KIT.some((it) => c.kit[it] !== "received"))
    : scope.filter((c) => c.phase !== "Active" && (SO[c.stage] === r.owner || (isAdmin && health(c.days) === "danger"))).sort((a, b) => b.days - a.days);
  const label = isAdmin ? "you" : r.label, noun = isProc ? "kit order" : "item";
  const maxPhase = Math.max(1, ...["Recruitment", "Documentation", "Onboarding", "Training"].map((p) => kpis[p]));
  const target = queueTarget(role);
  return (
    <div className="stack">
      <div className="hero">
        <div>
          <div className="hero-eyebrow">{meta.countries[country].flag} {city} · {r.label}</div>
          <h2 className="hero-title">{queue.length > 0 ? `${queue.length} ${noun}${queue.length === 1 ? "" : "s"} ${isProc ? "to order" : `waiting on ${label}`}` : `Nothing waiting on ${label} right now`}</h2>
          <p className="hero-sub">{kpis.pipeline} in the pipeline, {kpis.active} active on the floor.</p>
        </div>
        {target && canSee(meta, role, target.page) && <button className="btn btn-onhero" onClick={() => goto(target.page)}>{target.label} <ArrowRight size={16} /></button>}
      </div>
      <div className="stat-row">
        <Stat label="In pipeline" value={kpis.pipeline} note="candidates in progress" accent />
        <Stat label={isProc ? "To order" : "Your queue"} value={queue.length} note={isProc ? "kit not yet received" : "owned by your role"} />
        <Stat label="Stuck over 5 days" value={kpis.stuck} note="need a nudge" danger={kpis.stuck > 0} />
        <Stat label="Active staff" value={kpis.active} note="onboarded and working" />
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-h"><h3>{isProc ? "Kit to order" : "Your queue"}</h3><span className="panel-count">{queue.length}</span></div>
          <div className="list">
            {queue.length === 0 && <Empty>All clear. Nothing is on your desk right now.</Empty>}
            {queue.map((c) => (
              <button key={c.id} className="list-row" onClick={() => onOpen(c.id)}>
                <Avatar name={c.name} />
                <div className="lr-main"><div className="lr-name">{c.name}</div><div className="lr-sub">{c.role} · {c.warehouse}</div></div>
                <div className="lr-stage"><span className="lr-stagename">{c.stage}</span><Owner who={SO[c.stage]} /></div>
                <DaysCell d={c.days} /><ChevronRight size={16} className="lr-caret" />
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h3>Pipeline by phase</h3></div>
          <div className="funnel">
            {["Recruitment", "Documentation", "Onboarding", "Training"].map((p) => {
              const tp = p === "Recruitment" ? "applicants" : p === "Documentation" ? "documents" : p === "Onboarding" ? "assignment" : "matrix";
              const ok = canSee(meta, role, tp);
              return (
                <button key={p} className={"fn-row" + (ok ? "" : " fn-locked")} onClick={() => ok && goto(tp)}>
                  <span className="fn-label">{labelPhase(p)}</span>
                  <span className="fn-track"><span className="fn-fill" style={{ width: `${(kpis[p] / maxPhase) * 100}%` }} /></span>
                  <span className="fn-val">{kpis[p]}</span>
                </button>
              );
            })}
          </div>
          <div className="panel-h" style={{ marginTop: 18 }}><h3>Active by warehouse</h3></div>
          <div className="wh-mini">
            {Object.entries(scope.reduce((a, c) => { a[c.warehouse] = (a[c.warehouse] || 0) + (c.phase === "Active" ? 1 : 0); return a; }, {})).map(([w, n]) => <div className="whm-row" key={w}><span>{w}</span><span className="whm-n">{n}</span></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}

/* Applicants (add form + pending/shortlisted) */
function ApplicantsPage({ rows, onOpen, onSchedule, onShortlist, onAdd, onDelete, canDelete, onCv }) {
  const meta = useMeta();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", position: meta.positions[0] || "", cv: null, iso: "AE", phone: "" });
  const [adding, setAdding] = useState(false);
  const base = rows.filter((c) => c.phase === "Recruitment" && c.stage === "Pending interview");
  const { pos, setPos, positions, filtered: list } = usePositionFilter(base);

  async function submit() {
    if (adding) return;
    if (!form.name.trim() || !form.position) return;
    setAdding(true);
    const digits = form.phone.replace(/[^0-9]/g, "");
    const dial = (COUNTRY_CODES.find((c) => c.iso === form.iso) || {}).dial || "";
    const fullPhone = digits ? `${dial}${digits}` : "";
    try {
      const okDone = await onAdd({ ...form, phone: fullPhone });
      if (okDone) { setForm({ name: "", position: meta.positions[0] || "", cv: null, iso: "AE", phone: "" }); setShowAdd(false); }
    } finally { setAdding(false); }
  }
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">New candidates start pending an interview. Shortlist for later, or schedule the interview.</p>
        <div className="row-actions">
          <FilterBar pos={pos} setPos={setPos} positions={positions} />
          <button className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}><Plus size={16} /> Add candidate</button>
        </div>
      </div>
      {showAdd && (
        <div className="addcard">
          {meta.positions.length === 0 && <div className="warn-inline">Add positions in Setup first.</div>}
          <div className="add-grid">
            <label className="field"><span>Full name</span><input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Position</span>
              <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                {meta.positions.map((p) => <option key={p}>{p}</option>)}
              </select></label>
            <label className="field"><span>Phone (WhatsApp)</span>
              <div className="phone-input">
                <CountryCodeSelect value={form.iso} onChange={(iso) => setForm({ ...form, iso })} />
                <input inputMode="tel" placeholder="50 123 4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div></label>
            <label className="field"><span>CV (pdf, doc, image)</span>
              <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setForm({ ...form, cv: e.target.files[0] || null })} /></label>
          </div>
          <div className="add-actions">
            <button className="btn btn-ghost" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={adding}>{adding ? "Adding…" : "Add, pending interview"}</button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Candidate</th><th>Position</th><th>Stage</th><th>Through</th><th>Waiting</th><th className="ta-r">Actions</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}{c.hasCv ? " · CV" : ""}</div></div></div></td>
                <td>{c.role}</td>
                <td><Badge tone={c.stage === "Shortlisted" ? "info" : "neutral"}>{c.stage}</Badge></td>
                <td className="muted sm">{c.through || "Direct"}</td>
                <td><DaysCell d={c.days} /></td>
                <td className="ta-r"><div className="row-actions">
                  {c.hasCv && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onCv(c.id); }}><Paperclip size={13} /> CV</button>}
                  {c.stage === "Pending interview" && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onShortlist(c.id); }}>Shortlist</button>}
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onSchedule(c.id); }}><CalendarClock size={13} /> Schedule interview</button>
                  {canDelete(c.kind) && <IconDelete onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name); }} />}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty>No applicants pending in the selected city. Add one to get started.</Empty>}
      </div>
    </div>
  );
}

/* Interviews / Trials / Offers */
function usePositionFilter(rows) {
  const meta = useMeta();
  const [pos, setPos] = useState("all");
  const positions = ["all", ...meta.positions];
  const filtered = pos === "all" ? rows : rows.filter((r) => r.role === pos);
  return { pos, setPos, positions, filtered };
}
function FilterBar({ pos, setPos, positions }) {
  return (
    <div className="filterbar">
      <span className="fb-label">Position</span>
      <select value={pos} onChange={(e) => setPos(e.target.value)}>
        {positions.map((p) => <option key={p} value={p}>{p === "all" ? "All positions" : p}</option>)}
      </select>
    </div>
  );
}

function RecruitmentStagePage({ page, rows, onOpen, onDecline, onTrial, onOffer, onAccept, onUpdateOffer, onRejectOffer, onDownloadOffer, onReject, onShortlist, canReject, onDelete, canDelete, onCv }) {
  const meta = useMeta();
  const stageFor = { interviews: "Interview", trials: "Trial", offers: "Offer" }[page];
  const blurb = {
    interviews: "Booked in with the hiring manager. Move a candidate to a trial with a start date, warehouse and salary.",
    trials: "On a paid trial. Make an offer, or reject and log the days worked for payment.",
    offers: "Offer made. Download the offer letter, accept, edit the terms, or reject.",
  }[page];
  const base = rows.filter((c) => c.phase === "Recruitment" && c.stage === stageFor);
  const { pos, setPos, positions, filtered } = usePositionFilter(base);
  return (
    <div className="stack">
      <div className="page-head"><p className="blurb">{blurb}</p><FilterBar pos={pos} setPos={setPos} positions={positions} /></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Candidate</th><th>Position</th>{page === "offers" && <><th className="ta-r">Salary</th><th>Start</th></>}<th>Through</th><th>In stage</th><th className="ta-r">Actions</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}</div></div></div></td>
                <td>{c.role}</td>
                {page === "offers" && <><td className="ta-r mono">{c.salary ? money(c.salary) : "-"}</td><td className="sm">{c.startDate || "-"}</td></>}
                <td className="muted sm">{c.through || "Direct"}</td><td><DaysCell d={c.days} /></td>
                <td className="ta-r"><div className="row-actions">
                  {c.hasCv && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onCv(c.id); }}><Paperclip size={13} /> CV</button>}
                  {page === "interviews" && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onTrial(c.id); }}>Move to trial <ArrowRight size={14} /></button>}
                  {page === "interviews" && <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); onDecline(c.id); }}><Ban size={13} /> Reject</button>}
                  {page === "trials" && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onOffer(c.id); }}>Make offer <ArrowRight size={14} /></button>}
                  {page === "trials" && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onShortlist(c.id); }}>Shortlist</button>}
                  {page === "offers" && <>
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onDownloadOffer(c.id); }}><FileText size={13} /> Letter</button>
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onUpdateOffer(c.id); }}>Edit</button>
                    <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onAccept(c.id); }}>Accept</button>
                    <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); onRejectOffer(c.id); }}>Reject</button>
                  </>}
                  {canReject(c.stage) && <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); onReject(c.id); }}><Ban size={13} /> Reject</button>}
                  {canDelete(c.kind) && <IconDelete onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name); }} />}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>No one at this stage{pos !== "all" ? " for that position" : ""} in the selected city.</Empty>}
      </div>
    </div>
  );
}

/* Shortlist */
function ShortlistPage({ rows, onOpen, onSchedule, onDelete, canDelete, onCv }) {
  const base = rows.filter((c) => c.phase === "Recruitment" && c.stage === "Shortlisted");
  const { pos, setPos, positions, filtered } = usePositionFilter(base);
  return (
    <div className="stack">
      <div className="page-head"><p className="blurb">Candidates kept for later. Schedule an interview when you are ready.</p><FilterBar pos={pos} setPos={setPos} positions={positions} /></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Candidate</th><th>Position</th><th>Notes</th><th>Waiting</th><th className="ta-r">Actions</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}</div></div></div></td>
                <td>{c.role}</td><td className="muted sm">{c.shortlistNotes || "-"}</td><td><DaysCell d={c.days} /></td>
                <td className="ta-r"><div className="row-actions">
                  {c.hasCv && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onCv(c.id); }}><Paperclip size={13} /> CV</button>}
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onSchedule(c.id); }}><CalendarClock size={13} /> Schedule interview</button>
                  {canDelete(c.kind) && <IconDelete onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name); }} />}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>No shortlisted candidates{pos !== "all" ? " for that position" : ""}.</Empty>}
      </div>
    </div>
  );
}

/* Rejected */
function RejectedPage({ rows, onOpen, onDelete, canDelete }) {
  const base = rows.filter((c) => c.phase === "Rejected");
  const { pos, setPos, positions, filtered } = usePositionFilter(base);
  return (
    <div className="stack">
      <div className="page-head"><p className="blurb">Everyone who was rejected, and the stage they were rejected at.</p><FilterBar pos={pos} setPos={setPos} positions={positions} /></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Candidate</th><th>Position</th><th>Rejected at</th><th>Reason</th><th className="ta-r">Manage</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}</div></div></div></td>
                <td>{c.role}</td><td><Badge tone="neutral">{c.rejectedFrom || "-"}</Badge></td><td className="muted sm">{c.rejectReason || "-"}</td>
                <td className="ta-r">{canDelete(c.kind) && <IconDelete onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name); }} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>No rejected candidates{pos !== "all" ? " for that position" : ""}.</Empty>}
      </div>
    </div>
  );
}

/* Document processing */
function DocumentsPage({ rows, country, onOpen, onAdvance, onDecline, notify }) {
  const meta = useMeta();
  const docs = meta.phases.find((p) => p.key === "Documentation").stages;
  const stageDocs = meta.stageDocs || {};
  const docTypes = [...new Set(Object.values(stageDocs))];
  const [docFor, setDocFor] = useState(null);
  const base = rows.filter((c) => c.phase === "Documentation");
  const { pos, setPos, positions, filtered: list } = usePositionFilter(base);
  const cellState = (c, doc) => { const di = docs.indexOf(doc), ci = docs.indexOf(c.stage); return di < ci ? "done" : di === ci ? "now" : "pending"; };
  const [sent, setSent] = useState({});
  const [respFor, setRespFor] = useState(null);
  async function sendCollection(id) { try { const d = await api.post(`/candidates/${id}/send-collection`, {}); const de = d.delivery || {}; setSent((s) => ({ ...s, [`${id}:collection`]: true })); notify(de.sent ? "Collection request sent on WhatsApp" : de.error ? `Not sent: ${de.error}` : "Link ready (WhatsApp not configured)"); } catch (e) { notify(e.message); } }
  async function notifyMedical(id) { try { const d = await api.post(`/candidates/${id}/notify-medical`, {}); const de = d.delivery || {}; setSent((s) => ({ ...s, [`${id}:medical`]: true })); notify(de.sent ? "Manager notified on WhatsApp" : de.error ? `Not sent: ${de.error}` : "WhatsApp not configured"); } catch (e) { notify(e.message); } }
  return (
    <div className="stack">
      <div className="page-head"><p className="blurb">Processing government paperwork: gathering, processing, medical and tawjeeh, biometric, EID, then insurance. Upload each document at its stage: passport at gathering, medical at medical and tawjeeh, Emirates ID at EID, insurance card at insurance. Each is saved to the employee profile.</p><FilterBar pos={pos} setPos={setPos} positions={positions} /></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Employee</th>{docs.map((d) => <th key={d} className="ta-c">{d}</th>)}<th className="ta-r">Actions</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.warehouse}</div></div></div></td>
                {docs.map((d) => { const st = cellState(c, d); const durS = (c.stageDurations || {})[d]; return <td key={d} className="ta-c"><div className="stage-cell">{st === "done" && <><CheckCircle2 size={18} className="ic-done" />{durS != null && <span className="stage-days">{fmtDur(durS)}</span>}</>}{st === "now" && <><Clock size={18} className="ic-now" />{c.days != null && <span className="stage-days">{c.days}d</span>}</>}{st === "pending" && <Circle size={18} className="ic-pending" />}</div></td>; })}
                <td className="ta-r"><div className="row-actions">
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setRespFor(c); }}><FileText size={13} /> View response</button>
                  {c.stage === "Documents Collection" && (c.collectionSubmitted
                    ? <button className="btn btn-sm btn-ghost sent-pill" disabled><CheckCircle2 size={13} /> Submitted</button>
                    : (c.collectionSent || sent[`${c.id}:collection`])
                      ? <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); sendCollection(c.id); }}><MessageSquarePlus size={13} /> Resend</button>
                      : <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); sendCollection(c.id); }}><MessageSquarePlus size={13} /> Send request</button>)}
                  {c.stage === "Medical and Tawjeeh" && (sent[`${c.id}:medical`]
                    ? <button className="btn btn-sm btn-ghost sent-pill" disabled><CheckCircle2 size={13} /> Manager notified</button>
                    : <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); notifyMedical(c.id); }}><MessageSquarePlus size={13} /> Notify manager</button>)}
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onAdvance(c.id); }}>{c.stage === "Insurance registration" ? "Finish" : `Mark ${c.stage} done`} <ArrowRight size={14} /></button>
                  <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); onDecline(c.id); }}><Ban size={13} /> Cancel</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty>No one in document processing in the selected city.</Empty>}
      </div>
      <div className="doc-legend"><span><CheckCircle2 size={15} className="ic-done" /> Done</span><span><Clock size={15} className="ic-now" /> In progress</span><span><Circle size={15} className="ic-pending" /> Pending</span></div>
      {docFor && <DocumentsModal employee={docFor} labels={docTypes.length ? docTypes : docs} defaultLabel={stageDocs[docFor.stage] || ""} stage={docFor.stage} onClose={() => setDocFor(null)} />}
      {respFor && <CollectionResponseModal candidate={respFor} onClose={() => setRespFor(null)} />}
    </div>
  );
}

function CollectionResponseModal({ candidate, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get(`/candidates/${candidate.id}/collection`).then(setData).catch((e) => setErr(e.message)); }, []);
  async function openFile(which) {
    const res = await fetch(`/api/candidates/${candidate.id}/collection/${which}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank"); else notify("No file");
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Submitted response</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        {err && <div className="login-err">{err}</div>}
        {!data ? <Empty>Loading</Empty> : !data.submittedAt ? <Empty>This candidate has not submitted the form yet.</Empty> : (
          <div className="prof-grid">
            <div className="ro"><span className="ro-k">Submitted</span><span className="ro-v">{data.submittedAt ? new Date(data.submittedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</span></div>
            <div className="ro"><span className="ro-k">Visa status</span><span className="ro-v">{data.visaStatus || "-"}</span></div>
            <div className="ro"><span className="ro-k">T-shirt</span><span className="ro-v">{data.tshirt || "-"}</span></div>
            <div className="ro"><span className="ro-k">Pants</span><span className="ro-v">{data.pants || "-"}</span></div>
            <div className="ro"><span className="ro-k">Shoe</span><span className="ro-v">{data.shoe || "-"}</span></div>
            <div className="ro"><span className="ro-k">Passport copy</span><span className="ro-v">{data.passport ? <button className="btn btn-sm btn-ghost" onClick={() => openFile("passport")}>Open</button> : "not provided"}</span></div>
            <div className="ro"><span className="ro-k">Studio photo</span><span className="ro-v">{data.photo ? <button className="btn btn-sm btn-ghost" onClick={() => openFile("photo")}>Open</button> : "not provided"}</span></div>
          </div>
        )}
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      </div>
    </>
  );
}

/* Documents modal: upload / list / download / delete for one employee */
function DocumentsModal({ employee, labels, defaultLabel, stage, onClose }) {
  const [docs, setDocs] = useState(null);
  const [form, setForm] = useState({ label: defaultLabel || labels[0] || "", custom: "", expiry: "", file: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  function load() { api.get(`/candidates/${employee.id}/documents`).then(setDocs).catch((e) => setErr(e.message)); }
  useEffect(load, []);
  async function upload() {
    const label = form.label === "Other" ? form.custom.trim() : form.label;
    if (!label || !form.file) { setErr("Pick a type and a file"); return; }
    setBusy(true); setErr("");
    const fd = new FormData();
    fd.append("label", label); fd.append("file", form.file); if (form.expiry) fd.append("expiry", form.expiry);
    try { await api.postForm(`/candidates/${employee.id}/documents`, fd); setForm({ label: defaultLabel || labels[0] || "", custom: "", expiry: "", file: null }); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function download(d) {
    const res = await fetch(`/api/candidates/${employee.id}/documents/${d.id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank");
  }
  async function del(id) { try { await api.del(`/candidates/${employee.id}/documents/${id}`); load(); } catch (e) { setErr(e.message); } }
  const opts = [...labels, "Other"];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal modal-wide">
        <div className="modal-h"><div><div className="eyebrow">Documents</div><h3>{employee.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        {err && <div className="login-err">{err}</div>}
        {defaultLabel && <p className="setup-hint">At the {stage} stage, upload the {defaultLabel}. It is saved to this employee's profile.</p>}
        <div className="doc-upload">
          <select value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
          {form.label === "Other" && <input placeholder="Document name" value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} />}
          <input type="date" title="Expiry (optional)" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
          <input type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] || null })} />
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={upload}><Plus size={14} /> Upload</button>
        </div>
        <div className="doc-list">
          {(docs || []).map((d) => (
            <div className="doc-row" key={d.id}>
              <FileText size={15} className="muted" />
              <div className="doc-main"><div className="doc-label">{d.label}</div><div className="doc-sub">{d.filename}{d.expiry ? ` · expires ${d.expiry}` : ""}</div></div>
              <button className="btn btn-sm btn-ghost" onClick={() => download(d)}>Open</button>
              <button className="trash" onClick={() => del(d.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          {docs && docs.length === 0 && <Empty>No documents uploaded yet.</Empty>}
        </div>
      </div>
    </>
  );
}

/* Onboarding */
function OnboardingPage({ rows, onOpen, onAdvance }) {
  const steps = ["Uniform", "Warehouse assigned"];
  const list = rows.filter((c) => c.phase === "Onboarding");
  return (
    <div className="stack">
      <p className="blurb">New joiners get kitted out and assigned to a facility before training starts.</p>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Employee</th><th>Position</th><th>Warehouse</th>{steps.map((s) => <th key={s} className="ta-c">{s}</th>)}<th className="ta-r">Action</th></tr></thead>
          <tbody>
            {list.map((c) => {
              const ci = steps.indexOf(c.stage);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}</div></div></div></td>
                  <td>{c.role}</td><td className="muted">{c.warehouse}</td>
                  {steps.map((s, i) => <td key={s} className="ta-c">{i < ci ? <CheckCircle2 size={18} className="ic-done" /> : i === ci ? <Clock size={18} className="ic-now" /> : <Circle size={18} className="ic-pending" />}</td>)}
                  <td className="ta-r"><button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onAdvance(c.id); }}>Complete {c.stage} <ArrowRight size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <Empty>No one onboarding in the selected city.</Empty>}
      </div>
    </div>
  );
}

/* Procurement */
const PROC_TONE = { pending: "warning", ordered: "info", received: "success" };

/* Popup form to raise one work order with multiple item lines */
function WorkOrderModal({ items, employees, fixedEmployeeId, onClose, onCreate }) {
  const names = items.map((i) => i.name);
  const [employeeId, setEmployeeId] = useState(fixedEmployeeId ? String(fixedEmployeeId) : (employees && employees.length ? String(employees[0].id) : ""));
  const [lines, setLines] = useState([{ item: names[0] || "", size: "", quantity: 1 }]);
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines([...lines, { item: names[0] || "", size: "", quantity: 1 }]);
  const removeLine = (i) => setLines(lines.filter((_, j) => j !== i));
  const valid = employeeId && lines.some((l) => l.item);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal modal-wide">
        <div className="modal-h"><div><div className="eyebrow">New work order</div><h3>Uniform / procurement</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        {names.length === 0 && <div className="warn-inline">Add uniform items in Setup first.</div>}
        {!fixedEmployeeId && employees && (
          <label className="field"><span>Employee</span><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((em) => <option key={em.id} value={em.id}>{em.name} · {em.role}</option>)}</select></label>
        )}
        <div className="wo-lines">
          {lines.map((l, i) => (
            <div className="wo-line" key={i}>
              <select value={l.item} onChange={(e) => setLine(i, "item", e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select>
              <input placeholder="Size" value={l.size} onChange={(e) => setLine(i, "size", e.target.value)} style={{ width: 90 }} />
              <input className="num-input" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} style={{ width: 66 }} />
              {lines.length > 1 && <button className="trash" onClick={() => removeLine(i)}><X size={14} /></button>}
            </div>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={addLine}><Plus size={14} /> Add item</button>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid} onClick={() => onCreate({ employeeId: Number(employeeId), items: lines.filter((l) => l.item) })}>Create work order</button></div>
      </div>
    </>
  );
}

/* One work order shown as a card with its item lines */
function ProcOrderCard({ order, showEmployee, canManage, onStatus, onDelete, onEditLine, onOpen, onRequestSizes, sizesSent }) {
  const editable = canManage && order.status === "pending";
  return (
    <div className="wo-card">
      <div className="wo-head">
        {showEmployee ? <button className="wo-emp" onClick={() => onOpen && onOpen(order.employeeId)}><Avatar name={order.employee} sm /><span>{order.employee}</span></button> : <span className="muted sm">{order.orderedAt ? `Ordered ${order.orderedAt}` : `Raised ${order.createdAt}`}</span>}
        <div className="wo-head-r">
          {order.auto && <Badge tone="neutral">auto</Badge>}
          <Badge tone={PROC_TONE[order.status]}>{order.status}</Badge>
          {canManage && order.status === "pending" && <button className="btn btn-sm btn-primary" onClick={() => onStatus(order.id, "ordered")}>Mark ordered</button>}
          {canManage && order.status === "ordered" && <button className="btn btn-sm btn-primary" onClick={() => onStatus(order.id, "received")}>Mark received</button>}
          {canManage && order.status !== "received" && (sizesSent
            ? <button className="btn btn-sm btn-ghost sent-pill" disabled><CheckCircle2 size={13} /> Sizes requested</button>
            : <button className="btn btn-sm btn-primary" onClick={() => onRequestSizes && onRequestSizes(order.id)} title="WhatsApp the employee a link to enter their sizes"><MessageSquarePlus size={13} /> Request sizes</button>)}
          {canManage && <IconDelete onClick={() => onDelete(order.id)} />}
        </div>
      </div>
      <div className="wo-items">
        {order.items.map((it) => (
          <div className="wo-item" key={it.id}>
            <span className="wo-item-name">{it.item}</span>
            {editable ? <>
              <input className="wo-size" placeholder="Size" defaultValue={it.size || ""} onBlur={(e) => e.target.value !== (it.size || "") && onEditLine(order.id, it.id, { size: e.target.value })} />
              <input className="num-input wo-qty" defaultValue={it.quantity} onBlur={(e) => Number(e.target.value) !== it.quantity && onEditLine(order.id, it.id, { quantity: e.target.value })} />
            </> : <span className="wo-item-meta">{it.size ? `size ${it.size} · ` : ""}×{it.quantity}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Reusable per-employee uniform panel (used in the profile) */
function ProcurementPanel({ employeeId, role, notify }) {
  const meta = useMeta();
  const canManage = role === "admin" || role === "procurement" || role === "hr";
  const [orders, setOrders] = useState(null);
  const [modal, setModal] = useState(false);
  function load() { api.get(`/procurement/orders?employeeId=${employeeId}&category=uniform`).then(setOrders).catch((e) => notify && notify(e.message)); }
  useEffect(load, [employeeId]);
  async function create(payload) { try { await api.post("/procurement/orders", payload); setModal(false); load(); } catch (e) { notify && notify(e.message); } }
  async function status(id, s) { try { await api.patch(`/procurement/orders/${id}`, { status: s }); load(); } catch (e) { notify && notify(e.message); } }
  async function editLine(oid, iid, body) { try { await api.patch(`/procurement/orders/${oid}/items/${iid}`, body); load(); } catch (e) { notify && notify(e.message); } }
  async function del(id) { try { await api.del(`/procurement/orders/${id}`); load(); } catch (e) { notify && notify(e.message); } }
  const [sentSizes, setSentSizes] = useState({});
  async function requestSizes(id) { try { const d = await api.post(`/procurement/orders/${id}/request-sizes`, {}); const de = d.delivery || {}; setSentSizes((s) => ({ ...s, [id]: true })); notify && notify(de.sent ? "Sizes request sent on WhatsApp" : de.error ? `Not sent: ${de.error}` : "Link ready (WhatsApp not configured)"); } catch (e) { notify && notify(e.message); } }
  return (
    <div>
      {canManage && <div style={{ marginBottom: 14 }}><button className="btn btn-sm btn-primary" onClick={() => setModal(true)}><Plus size={14} /> New uniform order</button></div>}
      {!orders ? <Empty>Loading</Empty> : orders.length === 0 ? <Empty>No uniform orders for this employee yet.</Empty> :
        <div className="wo-list">{orders.map((o) => <ProcOrderCard key={o.id} order={o} showEmployee={false} canManage={canManage} onStatus={status} onDelete={del} onEditLine={editLine} onRequestSizes={requestSizes} />)}</div>}
      {modal && <WorkOrderModal items={meta.uniformItems} fixedEmployeeId={employeeId} onClose={() => setModal(false)} onCreate={create} />}
    </div>
  );
}

/* Procurement page: uniform work orders across the city */
function ProcurementPage({ employees, country, city, role, notify, onOpen }) {
  const meta = useMeta();
  const canManage = role === "admin" || role === "procurement" || role === "hr";
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  function load() { const q = filter === "all" ? "" : `&status=${filter}`; api.get(`/procurement/orders?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}${q}`).then(setOrders).catch((e) => notify(e.message)); }
  useEffect(load, [country, city, filter]);
  async function create(payload) { try { await api.post("/procurement/orders", payload); setModal(false); load(); notify("Work order raised"); } catch (e) { notify(e.message); } }
  async function status(id, s) { try { await api.patch(`/procurement/orders/${id}`, { status: s }); load(); } catch (e) { notify(e.message); } }
  async function editLine(oid, iid, body) { try { await api.patch(`/procurement/orders/${oid}/items/${iid}`, body); load(); } catch (e) { notify(e.message); } }
  async function del(id) { try { await api.del(`/procurement/orders/${id}`); load(); } catch (e) { notify(e.message); } }
  const [sentSizes, setSentSizes] = useState({});
  async function requestSizes(id) { try { const d = await api.post(`/procurement/orders/${id}/request-sizes`, {}); const de = d.delivery || {}; setSentSizes((s) => ({ ...s, [id]: true })); notify(de.sent ? "Sizes request sent on WhatsApp" : de.error ? `Not sent: ${de.error}` : "Link ready (WhatsApp not configured)"); } catch (e) { notify(e.message); } }
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">Uniform work orders. New hires get one automatically when they pass Medical & Tawjeeh; raise extra or replacement orders here for any employee. Each order can hold several items and moves from pending to ordered to received as a whole.</p>
        <div className="row-actions">
          <div className="filterbar"><span className="fb-label">Status</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="ordered">Ordered</option><option value="received">Received</option></select></div>
          {canManage && <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New work order</button>}
        </div>
      </div>
      {!orders ? <Empty>Loading</Empty> : orders.length === 0 ? <Empty>No work orders{filter !== "all" ? ` (${filter})` : ""} in the selected city.</Empty> :
        <div className="wo-list">{orders.map((o) => <ProcOrderCard key={o.id} order={o} showEmployee={true} canManage={canManage} onStatus={status} onDelete={del} onEditLine={editLine} onOpen={onOpen} onRequestSizes={requestSizes} />)}</div>}
      {modal && <WorkOrderModal items={meta.uniformItems} employees={employees} onClose={() => setModal(false)} onCreate={create} />}
    </div>
  );
}
/* Training */
function TrainingPage({ rows, onOpen, onReject, canReject, role, refresh, notify }) {
  const meta = useMeta();
  const canAssign = role === "admin" || role === "hr";
  const levels = ["Basics", "Safety", "Application"];
  const [users, setUsers] = useState([]);
  const [sel, setSel] = useState({});
  const [levelFilter, setLevelFilter] = useState("all");
  useEffect(() => { api.get("/users").then((u) => setUsers(u.filter((x) => x.active))).catch(() => {}); }, []);
  const base = rows.filter((c) => c.phase === "Training");
  const active = levelFilter === "all" ? null : levelFilter;
  const list = active ? base.filter((c) => c.phase === "Training" && c.stage === active) : base;
  async function assign(id, stage) {
    const userId = sel[id]; if (!userId) { notify("Pick a trainer to assign"); return; }
    try { const d = await api.post(`/candidates/${id}/training/assign`, { stage, userId: Number(userId) }); const de = d.delivery || {}; notify(de.sent ? "Assigned and notified on WhatsApp" : de.error ? `Assigned (WhatsApp not sent: ${de.error})` : "Assigned"); refresh(); } catch (e) { notify(e.message); }
  }
  async function complete(id, stage) { try { await api.post(`/candidates/${id}/training/complete`, { stage }); notify(`${stage} marked complete`); refresh(); loadReq(); } catch (e) { notify(e.message); } }
  const [reqs, setReqs] = useState([]);
  function loadReq() { api.get("/candidates/training-requests").then(setReqs).catch(() => {}); }
  useEffect(loadReq, []);
  return (
    <div className="stack">
      {reqs.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h3>Requested training sessions</h3></div>
          <p className="setup-hint">One-off training requested by active employees (via the assistant). Assign a trainer and mark it complete when done. It does not move them through the recruit pipeline.</p>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Employee</th><th>Level</th><th>Trainer</th><th className="ta-r">Action</th></tr></thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id + r.stage}>
                    <td><div className="cell-person"><Avatar name={r.name} sm /><div><div className="cp-name">{r.name}</div><div className="cp-id">{r.role}{r.warehouse ? ` · ${r.warehouse}` : ""}</div></div></div></td>
                    <td><Badge tone="info">{r.stage}</Badge></td>
                    <td className="sm">{r.assignee || <span className="muted">unassigned</span>}</td>
                    <td className="ta-r"><div className="row-actions">
                      {canAssign && <><select className="mini-select" value={sel[r.id] || ""} onChange={(e) => setSel({ ...sel, [r.id]: e.target.value })}><option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                      <button className="btn btn-sm btn-ghost" onClick={async () => { const uid = sel[r.id]; if (!uid) { notify("Pick a trainer"); return; } try { await api.post(`/candidates/${r.id}/training/assign`, { stage: r.stage, userId: Number(uid) }); notify("Assigned"); loadReq(); } catch (e) { notify(e.message); } }}>Assign</button></>}
                      <button className="btn btn-sm btn-primary" onClick={() => complete(r.id, r.stage)}><Check size={13} /> Complete</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="page-head">
        <p className="blurb">Assign a trainer to each level. They get a WhatsApp with the task, run the training, then mark it complete, which moves the employee to the next level.</p>
        <div className="filterbar"><span className="fb-label">Level</span>
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="all">All levels</option>{levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Employee</th><th>Warehouse</th>
            {levels.map((l) => <th key={l} className={"ta-c" + (l === active ? " col-focus" : "")}>{l}</th>)}
            <th>Current</th><th className="ta-r">Action</th>
          </tr></thead>
          <tbody>
            {list.map((c) => {
              const done = c.phase === "Active";
              const ci = done ? levels.length : levels.indexOf(c.stage);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.role}</div></div></div></td>
                  <td className="muted">{c.warehouse}</td>
                  {levels.map((l, i) => <td key={l} className="ta-c">{i < ci ? <CheckCircle2 size={18} className="ic-done" /> : i === ci ? <Clock size={18} className="ic-now" /> : <Circle size={18} className="ic-pending" />}</td>)}
                  <td>{done ? <Badge tone="orange">Active</Badge> : <div><Badge tone="success">{c.stage}</Badge>{c.trainingAssignee && <div className="sm muted" style={{ marginTop: 3 }}>{c.trainingAssignee}</div>}</div>}</td>
                  <td className="ta-r" onClick={(e) => e.stopPropagation()}>{done ? <span className="muted sm">Complete</span> : (
                    <div className="row-actions">
                      {!c.trainingAssignee && canAssign && (<>
                        <select className="mini-select" value={sel[c.id] || ""} onChange={(e) => setSel({ ...sel, [c.id]: e.target.value })}>
                          <option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                        <button className="btn btn-sm btn-primary" onClick={() => assign(c.id, c.stage)}>Assign</button>
                      </>)}
                      {c.trainingAssignee && (<>
                        <button className="btn btn-sm btn-primary" onClick={() => complete(c.id, c.stage)}><Check size={13} /> Mark complete</button>
                        {canAssign && <button className="btn btn-sm btn-ghost" onClick={() => assign(c.id, c.stage)} title="Reassign to the selected user">Reassign</button>}
                        {canAssign && <select className="mini-select" value={sel[c.id] || ""} onChange={(e) => setSel({ ...sel, [c.id]: e.target.value })}><option value="">Change…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
                      </>)}
                      {canReject(c.stage) && <button className="btn btn-sm btn-ghost reject-btn" onClick={() => onReject(c.id)}><Ban size={13} /> Reject</button>}
                    </div>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <Empty>{active ? `No employees at the ${active} level in the selected city.` : "No one in training in the selected city."}</Empty>}
      </div>
    </div>
  );
}

/* Employees */
function EmployeesPage({ rows, country, onOpen, onDelete, canDelete, onAdd, canAdd }) {
  const meta = useMeta();
  const flat = flatStages(meta, country);
  const [showAdd, setShowAdd] = useState(false);
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">Employees in the selected city: everyone from offer accepted through active. Candidates in recruitment are under Recruitment.</p>
        {canAdd && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}><Plus size={15} /> Add employee</button>}
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Employee</th><th>Position</th><th>Warehouse</th><th>Phase</th><th>Stage</th><th>Owner</th><th className="ta-r">{canDelete ? "Progress / manage" : "Progress"}</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const idx = flat.findIndex((f) => f.phase === c.phase && f.stage === c.stage);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td><div className="cell-person"><Avatar name={c.name} sm /><div><div className="cp-name">{c.name}</div><div className="cp-id">{c.code}</div></div></div></td>
                  <td>{c.role}</td><td className="muted">{c.warehouse}</td>
                  <td><PhaseTag phase={c.phase} /></td><td className="sm">{c.stage}</td>
                  <td><Owner who={meta.stageOwner[c.stage]} /></td>
                  <td className="ta-r"><div className="row-actions" style={{ justifyContent: "flex-end" }}>
                    <div className="mini-rail">{flat.map((f, i) => <span key={i} className={"mr-seg" + (i <= idx ? " fill" : "")} />)}</div>
                    {canDelete && <IconDelete onClick={(e) => { e.stopPropagation(); onDelete(c.id, c.name); }} />}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No employees match your search in the selected city.</Empty>}
      </div>
      {showAdd && <AddEmployeeModal country={country} onClose={() => setShowAdd(false)} onAdd={onAdd} />}
    </div>
  );
}

function AddEmployeeModal({ country, onClose, onAdd }) {
  const meta = useMeta();
  const cities = meta.cities.filter((c) => c.country === country).map((c) => c.name);
  const [f, setF] = useState({ name: "", position: meta.positions[0] || "", city: cities[0] || "", warehouse: "", salary: "", startDate: "", iso: country === "KSA" ? "SA" : "AE", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const warehouses = meta.warehouses.filter((w) => w.city === f.city).map((w) => w.name);
  async function submit() {
    if (busy) return;
    if (!f.name.trim() || !f.position || !f.city) { setErr("Name, position and city are required"); return; }
    setBusy(true); setErr("");
    const digits = f.phone.replace(/[^0-9]/g, "");
    const dial = (COUNTRY_CODES.find((c) => c.iso === f.iso) || {}).dial || "";
    const phone = digits ? `${dial}${digits}` : "";
    try { await onAdd({ name: f.name.trim(), position: f.position, country, city: f.city, warehouse: f.warehouse || null, salary: f.salary, startDate: f.startDate, email: f.email, phone }); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Existing employee</div><h3>Add employee</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-sub">Adds someone who already works here straight to active, skipping recruitment. They appear in the employees list immediately.</p>
        {err && <div className="login-err">{err}</div>}
        <div className="add-grid">
          <label className="field"><span>Full name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span>Position</span><select value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}>{meta.positions.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="field"><span>City</span><select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, warehouse: "" })}>{cities.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Warehouse</span><select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}><option value="">Select</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label>
          <label className="field"><span>Salary (AED/month)</span><input className="num-input" style={{ width: "100%" }} value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></label>
          <label className="field"><span>Start date</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="field"><span>WhatsApp number</span>
            <div className="phone-row">
              <CountryCodeSelect value={f.iso} onChange={(iso) => setF({ ...f, iso })} />
              <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="50 123 4567" />
            </div>
          </label>
          <label className="field"><span>Email (optional)</span><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        </div>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add employee"}</button></div>
      </div>
    </>
  );
}

/* Warehouses */
function WarehousesPage({ scope }) {
  const groups = scope.reduce((a, c) => { (a[c.warehouse] ||= []).push(c); return a; }, {});
  return (
    <div className="stack">
      <p className="blurb">Headcount and pipeline load per facility in the selected city.</p>
      <div className="wh-grid">
        {Object.entries(groups).map(([w, people]) => {
          const active = people.filter((p) => p.phase === "Active").length;
          return (
            <div className="wh-card" key={w}>
              <div className="wh-head"><Warehouse size={18} /><span>{w}</span></div>
              <div className="wh-stats">
                <div><div className="wh-n accent">{active}</div><div className="wh-cap">Active</div></div>
                <div><div className="wh-n">{people.length - active}</div><div className="wh-cap">In pipeline</div></div>
                <div><div className="wh-n">{people.length}</div><div className="wh-cap">Total</div></div>
              </div>
            </div>
          );
        })}
        {Object.keys(groups).length === 0 && <Empty>No facilities with people in the selected city.</Empty>}
      </div>
    </div>
  );
}

/* Users & access */
function UsersPage({ notify }) {
  const meta = useMeta();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "hr", phone: "" });
  const [showAdd, setShowAdd] = useState(false);
  const roleKeys = Object.keys(meta.roles);
  function load() { api.get("/users").then(setUsers).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function add() {
    if (!form.name || !form.email || !form.password) return;
    try { await api.post("/users", form); setForm({ name: "", email: "", password: "", role: "hr", phone: "" }); setShowAdd(false); load(); notify("User created"); }
    catch (e) { notify(e.message); }
  }
  async function patch(id, body) { try { await api.patch(`/users/${id}`, body); load(); } catch (e) { notify(e.message); } }
  async function del(id, name) { if (!window.confirm(`Delete user ${name}?`)) return; try { await api.del(`/users/${id}`); load(); notify("User deleted"); } catch (e) { notify(e.message); } }
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">Create logins and set what each person can access. The role controls which pages and actions are available.</p>
        <button className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}><Plus size={16} /> Add user</button>
      </div>
      {showAdd && (
        <div className="addcard">
          <div className="add-grid add-grid-4">
            <label className="field"><span>Full name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span>Temporary password</span><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <label className="field"><span>Role</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roleKeys.map((k) => <option key={k} value={k}>{meta.roles[k].label}</option>)}</select></label>
            <label className="field"><span>WhatsApp number (for training tasks)</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+9715XXXXXXXX" /></label>
          </div>
          <div className="add-actions"><button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn btn-primary" onClick={add}>Create user</button></div>
        </div>
      )}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>WhatsApp</th><th>Role</th><th>Status</th><th className="ta-r">Manage</th></tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.id}>
                <td><div className="cell-person"><Avatar name={u.name} sm /><div className="cp-name">{u.name}</div></div></td>
                <td className="muted mono sm">{u.email}</td>
                <td><input className="csr-phone" defaultValue={u.phone || ""} placeholder="+9715…" onBlur={(e) => (e.target.value || "") !== (u.phone || "") && patch(u.id, { phone: e.target.value })} /></td>
                <td><select className="mini-select" value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>{roleKeys.map((k) => <option key={k} value={k}>{meta.roles[k].label}</option>)}</select></td>
                <td><button className={"pill " + (u.active ? "pill-on" : "pill-off")} onClick={() => patch(u.id, { active: !u.active })}>{u.active ? "Active" : "Inactive"}</button></td>
                <td className="ta-r"><IconDelete onClick={() => del(u.id, u.name)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {users && users.length === 0 && <Empty>No users yet.</Empty>}
        {!users && <Empty>Loading</Empty>}
      </div>
    </div>
  );
}

/* Setup */
function ConfigList({ type, title, hint, cols, options, notify, refreshMeta }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  function load() { api.get(`/config/${type}`).then(setRows).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function add() {
    for (const c of cols) if (!draft[c.key]) return;
    try { await api.post(`/config/${type}`, draft); setDraft({}); load(); refreshMeta(); }
    catch (e) { notify(e.message); }
  }
  async function del(id) { try { await api.del(`/config/${type}/${id}`); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  return (
    <section className="panel setup-panel">
      <div className="panel-h"><h3>{title}</h3></div>
      {hint && <p className="setup-hint">{hint}</p>}
      <div className="chips">
        {(rows || []).map((r) => (
          <span className="chip" key={r.id}>{cols.map((c) => r[c.key]).join(" · ")}<button onClick={() => del(r.id)}><X size={13} /></button></span>
        ))}
        {rows && rows.length === 0 && <span className="muted sm">None yet.</span>}
      </div>
      <div className="setup-add">
        {cols.map((c) => (c.key in (options || {})) ? (
          <select key={c.key} value={draft[c.key] || ""} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })}>
            <option value="">{c.label}</option>{options[c.key].map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input key={c.key} placeholder={c.label} value={draft[c.key] || ""} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        ))}
        <button className="btn btn-sm btn-primary" onClick={add}><Plus size={14} /> Add</button>
      </div>
    </section>
  );
}
function LeaveDefaultSetup({ notify }) {
  const [days, setDays] = useState("");
  const [notice, setNotice] = useState("");
  const [movers, setMovers] = useState("");
  const [saved, setSaved] = useState({ days: "", notice: "", movers: "" });
  useEffect(() => { api.get("/settings/general").then((d) => { setDays(String(d.defaultLeaveDays)); setNotice(String(d.leaveNoticeDays ?? 7)); setMovers(String(d.maxMoversOnLeave ?? 2)); setSaved({ days: String(d.defaultLeaveDays), notice: String(d.leaveNoticeDays ?? 7), movers: String(d.maxMoversOnLeave ?? 2) }); }).catch(() => {}); }, []);
  const dirty = days !== saved.days || notice !== saved.notice || movers !== saved.movers;
  async function save() { try { const r = await api.put("/settings/general", { defaultLeaveDays: Number(days), leaveNoticeDays: Number(notice), maxMoversOnLeave: Number(movers) }); setSaved({ days: String(r.defaultLeaveDays), notice: String(r.leaveNoticeDays), movers: String(r.maxMoversOnLeave) }); notify("Leave rules saved"); } catch (e) { notify(e.message); } }
  return (
    <section className="panel">
      <div className="panel-h"><h3>Leave rules</h3></div>
      <p className="setup-hint">These apply to all employees and are used by the chatbot and approvals. Sick and unpaid leave don't use annual days. The chatbot enforces advance notice and team coverage against these values.</p>
      <div className="prof-edit">
        <Field label="Annual leave entitlement (days/year)"><input className="num-input" style={{ width: "100%" }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} /></Field>
        <Field label="Advance notice for leave (days)"><input className="num-input" style={{ width: "100%" }} inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value.replace(/[^0-9]/g, ""))} /></Field>
        <Field label="Movers allowed on leave at once"><input className="num-input" style={{ width: "100%" }} inputMode="numeric" value={movers} onChange={(e) => setMovers(e.target.value.replace(/[^0-9]/g, ""))} /></Field>
      </div>
      <div className="prof-actions"><button className="btn btn-sm btn-primary" disabled={!dirty} onClick={save}>Save leave rules</button></div>
    </section>
  );
}

function SetupPage({ notify, refreshMeta }) {
  const meta = useMeta();
  const countryKeys = Object.keys(meta.countries);
  const allCities = meta.cities.map((c) => c.name);
  const [tab, setTab] = useState("org");
  const tabs = [
    { id: "org", label: "Organisation" },
    { id: "salary", label: "Salary" },
    { id: "uniforms", label: "Uniforms & documents" },
    { id: "calendars", label: "Calendars" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "access", label: "Access & roles" },
  ];
  return (
    <div className="stack">
      <p className="blurb">Configure the lists and integrations used across the app. Changes here update the dropdowns everywhere, including add candidate.</p>
      <div className="tabbar">
        {tabs.map((t) => <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "org" && (
        <div className="setup-grid">
          <LeaveDefaultSetup notify={notify} />
          <ConfigList type="positions" title="Positions" hint="Job roles used when adding a candidate. Team decides the leave coverage rule: Warehouse (one per branch) or Movers (shared limit)." cols={[{ key: "name", label: "Position name" }, { key: "team", label: "Team" }]} options={{ team: ["Warehouse", "Movers"] }} notify={notify} refreshMeta={refreshMeta} />
          <ConfigList type="cities" title="Cities" hint="Cities per country, shown in the location switcher." cols={[{ key: "country", label: "Country" }, { key: "name", label: "City name" }]} options={{ country: countryKeys }} notify={notify} refreshMeta={refreshMeta} />
          <ConfigList type="warehouses" title="Warehouses" hint="Facilities per city." cols={[{ key: "city", label: "City" }, { key: "name", label: "Warehouse name" }]} options={{ city: allCities }} notify={notify} refreshMeta={refreshMeta} />
        </div>
      )}
      {tab === "salary" && (
        <div className="setup-grid">
          <SalaryComponentsSetup notify={notify} refreshMeta={refreshMeta} />
        </div>
      )}
      {tab === "uniforms" && (
        <div className="setup-grid">
          <UniformItemsSetup notify={notify} refreshMeta={refreshMeta} />
          <ConfigList type="document-types" title="Document types" hint="Document labels used across the app." cols={[{ key: "name", label: "Document type" }]} notify={notify} refreshMeta={refreshMeta} />
        </div>
      )}
      {tab === "calendars" && <CalendarsSetup notify={notify} />}
      {tab === "whatsapp" && <WhatsAppSettings notify={notify} />}
      {tab === "access" && <><RolesSetup notify={notify} refreshMeta={refreshMeta} /><DangerZone notify={notify} /></>}
    </div>
  );
}

function DangerZone({ notify }) {
  const [busy, setBusy] = useState(false);
  async function clearAll() {
    const typed = window.prompt("This permanently deletes ALL candidates, employees, requests, payments and related records. Users, roles and configuration are kept. Type DELETE to confirm.");
    if (typed !== "DELETE") { if (typed !== null) notify("Not confirmed"); return; }
    setBusy(true);
    try { await api.post("/admin/clear-all", { confirm: "DELETE" }); notify("All data cleared"); setTimeout(() => window.location.reload(), 800); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="panel" style={{ borderColor: "rgba(220,38,38,.35)", marginTop: 16 }}>
      <div className="panel-h"><h3 style={{ color: "#b91c1c" }}>Danger zone</h3></div>
      <p className="setup-hint">Permanently delete all people and operational data (candidates, employees, requests, payments, leaves, uniforms, salary sheets). Your admin login, roles, and configuration lists are kept. This cannot be undone.</p>
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={clearAll}><Trash2 size={14} /> {busy ? "Clearing…" : "Clear all data"}</button>
    </section>
  );
}

function RolesSetup({ notify, refreshMeta }) {
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [nf, setNf] = useState({ key: "", label: "", pages: [] });
  const [editKey, setEditKey] = useState(null);
  const [editPages, setEditPages] = useState([]);
  function load() { api.get("/roles").then(setData).catch((e) => notify(e.message)); }
  useEffect(load, []);
  const pages = data ? data.pages : [];
  const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  async function create() {
    if (!nf.key.trim() || !nf.label.trim()) { notify("Enter a key and a label"); return; }
    try { await api.post("/roles", nf); setNf({ key: "", label: "", pages: [] }); setCreating(false); load(); refreshMeta && refreshMeta(); notify("Role created"); } catch (e) { notify(e.message); }
  }
  async function saveEdit(key) {
    try { await api.put(`/roles/${key}`, { pages: editPages }); setEditKey(null); load(); refreshMeta && refreshMeta(); notify("Access updated"); } catch (e) { notify(e.message); }
  }
  async function del(key) { if (!window.confirm(`Delete the "${key}" role?`)) return; try { await api.del(`/roles/${key}`); load(); refreshMeta && refreshMeta(); notify("Role deleted"); } catch (e) { notify(e.message); } }
  return (
    <section className="panel">
      <div className="panel-h"><h3>Roles and access</h3>{!creating && <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New role</button>}</div>
      <p className="setup-hint">Create a role and tick which pages it can access. Assign roles to people on the Users page. Admin always has full access.</p>
      {creating && (
        <div className="role-create" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div className="setup-add">
            <input placeholder="Key (e.g. supervisor)" value={nf.key} onChange={(e) => setNf({ ...nf, key: e.target.value })} style={{ maxWidth: 180 }} />
            <input placeholder="Label (e.g. Supervisor)" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} style={{ maxWidth: 220 }} />
          </div>
          <div className="perm-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 6, margin: "10px 0" }}>
            {pages.map((p) => (
              <label key={p.id} className="sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={nf.pages.includes(p.id)} onChange={() => setNf({ ...nf, pages: toggle(nf.pages, p.id) })} />{p.label}
              </label>
            ))}
          </div>
          <div className="row-actions"><button className="btn btn-sm btn-ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-sm btn-primary" onClick={create}>Create role</button></div>
        </div>
      )}
      <div className="role-list">
        {(data ? data.roles : []).map((r) => (
          <div key={r.key} className="role-row" style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><strong>{r.label}</strong> <span className="muted sm">· {r.key}</span> {r.isAdmin && <Badge tone="orange">full access</Badge>}</div>
              {!r.isAdmin && (editKey === r.key
                ? <div className="row-actions"><button className="btn btn-sm btn-ghost" onClick={() => setEditKey(null)}>Cancel</button><button className="btn btn-sm btn-primary" onClick={() => saveEdit(r.key)}>Save</button></div>
                : <div className="row-actions"><button className="btn btn-sm btn-ghost" onClick={() => { setEditKey(r.key); setEditPages(r.pages === "*" ? [] : r.pages); }}>Edit access</button>{!r.protected && <button className="trash" onClick={() => del(r.key)}><Trash2 size={14} /></button>}</div>)}
            </div>
            {editKey === r.key ? (
              <div className="perm-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 6, marginTop: 8 }}>
                {pages.map((p) => (
                  <label key={p.id} className="sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={editPages.includes(p.id)} onChange={() => setEditPages(toggle(editPages, p.id))} />{p.label}
                  </label>
                ))}
              </div>
            ) : (
              <div className="muted sm" style={{ marginTop: 4 }}>{r.isAdmin ? "All pages" : (r.pages.length ? r.pages.map((id) => (pages.find((p) => p.id === id) || {}).label || id).join(", ") : "No pages yet")}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* No access */
function NoAccess({ role }) {
  const meta = useMeta();
  return (
    <div className="noaccess"><span className="na-ico"><Lock size={26} /></span><h3>No access to this page</h3>
      <p>Your role ({meta.roles[role]?.label || role}) cannot open this page. Use the sidebar to reach the pages assigned to you.</p></div>
  );
}

/* Drawer */
function Drawer({ c, country, role, onClose, onAdvance, onSchedule, onShortlist, onAccept, onTrial, onOffer, onUpdateOffer, onRejectOffer, onDownloadOffer, onDecline, onReject, canReject, onProfile, onDelete, canDelete, onCv }) {
  const meta = useMeta();
  const lc = lifecycle(meta, country);
  const flat = flatStages(meta, country);
  const curIdx = flat.findIndex((f) => f.phase === c.phase && f.stage === c.stage);
  const atEnd = curIdx === flat.length - 1;
  let actions = [];
  if (c.stage === "Pending interview") actions = [{ l: "Schedule interview", f: onSchedule, primary: true }, { l: "Shortlist", f: onShortlist }, { l: "Reject", f: onDecline, danger: true }];
  else if (c.stage === "Shortlisted") actions = [{ l: "Schedule interview", f: onSchedule, primary: true }, { l: "Reject", f: onDecline, danger: true }];
  else if (c.stage === "Interview") actions = [{ l: "Move to trial", f: onTrial, primary: true }, { l: "Shortlist", f: onShortlist }, { l: "Reject", f: onDecline, danger: true }];
  else if (c.stage === "Trial") actions = [{ l: "Make offer", f: onOffer, primary: true }, { l: "Shortlist", f: onShortlist }];
  else if (c.stage === "Offer") actions = [{ l: "Accept offer", f: onAccept, primary: true }, { l: "Edit offer", f: onUpdateOffer }, { l: "Letter", f: onDownloadOffer }, { l: "Reject offer", f: onRejectOffer, danger: true }];
  else if (c.phase === "Documentation") actions = [{ l: "Advance", f: onAdvance, primary: true }, { l: "Cancel", f: onDecline, danger: true }];
  else if (c.phase !== "Rejected" && !atEnd) actions = [{ l: "Advance", f: onAdvance, primary: true }];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <button className="icon-btn drawer-x" onClick={onClose}><X size={18} /></button>
        <div className="dr-head">
          <span className="dr-avatar">{initials(c.name)}</span>
          <div><div className="dr-name">{c.name}</div><div className="dr-role">{c.role} · {c.code} · {c.kind}</div></div>
        </div>
        <div className="dr-meta">
          <div><div className="dm-k">Location</div><div className="dm-v">{meta.countries[c.country].flag} {c.city}</div></div>
          <div><div className="dm-k">Warehouse</div><div className="dm-v">{c.warehouse}</div></div>
          <div><div className="dm-k">Owner now</div><div className="dm-v"><Owner who={meta.stageOwner[c.stage]} /></div></div>
          <div><div className="dm-k">In stage</div><div className="dm-v"><DaysCell d={c.days} /></div></div>
        </div>
        <div className="dr-current">
          <div><div className="dm-k">Current</div><div className="dr-cur-stage">{c.phase} · {c.stage}</div></div>
          <div className="row-actions">
            {actions.map((a) => <button key={a.l} className={"btn btn-sm " + (a.primary ? "btn-primary" : a.danger ? "btn-ghost reject-btn" : "btn-ghost")} onClick={() => a.f(c.id)}>{a.l}</button>)}
            {canReject && <button className="btn btn-sm btn-ghost reject-btn" onClick={() => onReject(c.id)}><Ban size={14} /> Reject</button>}
          </div>
        </div>
        {c.hasCv && <button className="btn btn-ghost btn-block" onClick={() => onCv(c.id)}><Paperclip size={15} /> View CV ({c.cvName})</button>}
        <div className="journey">
          <div className="eyebrow">Journey</div>
          {lc.map((p) => (
            <div className="jp" key={p.key}>
              <div className="jp-label">{p.key}</div>
              {p.stages.map((s) => {
                const gi = flat.findIndex((f) => f.phase === p.key && f.stage === s);
                const state = gi < curIdx ? "done" : gi === curIdx ? "now" : "next";
                return (<div className={"jn j-" + state} key={s}><span className="jdot">{state === "done" ? <CheckCircle2 size={13} /> : null}</span><span className="jlabel">{s}</span><span className="jowner">{meta.stageOwner[s]}</span></div>);
              })}
            </div>
          ))}
        </div>
        {c.events && c.events.length > 0 && (
          <div className="journey">
            <div className="eyebrow">Activity</div>
            <div className="events">
              {c.events.slice(0, 8).map((e, i) => (<div className="ev-row" key={i}><span className="ev-dot" /><div><div className="ev-detail">{e.detail}</div><div className="ev-meta">{e.actor} · {new Date(e.created_at).toLocaleDateString()}</div></div></div>))}
            </div>
          </div>
        )}
        <div className="drawer-foot">
          {c.kind === "employee" && onProfile && <button className="btn btn-primary btn-block" onClick={() => onProfile(c.id)}><Users size={16} /> Open full profile</button>}
          <button className="btn btn-ghost btn-block"><MessageCircle size={16} /> Message on WhatsApp</button>
          {canDelete && <button className="btn btn-danger btn-block" onClick={() => onDelete(c.id, c.name)}><Trash2 size={15} /> Delete record</button>}
        </div>
      </aside>
    </>
  );
}

/* ===== Accounting: month helpers ===== */
function shiftMonth(m, delta) { const [y, mo] = m.split("-").map(Number); const idx = y * 12 + (mo - 1) + delta; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`; }
// Safe arithmetic evaluator for salary formulas: + - * / ( ), decimals, vars (x, base).
function evalFormula(expr, vars) {
  if (!expr) return 0;
  try {
    const s = String(expr); const out = [], ops = []; let i = 0, prev = null;
    const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
    while (i < s.length) {
      const c = s[i];
      if (c === " ") { i++; continue; }
      if (/[0-9.]/.test(c)) { let j = i + 1; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push(parseFloat(s.slice(i, j))); i = j; prev = "n"; continue; }
      if (/[a-zA-Z_]/.test(c)) { let j = i + 1; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++; const nm = s.slice(i, j); if (!(nm in vars)) return 0; out.push(Number(vars[nm]) || 0); i = j; prev = "n"; continue; }
      if (c === "(") { ops.push(c); i++; prev = "("; continue; }
      if (c === ")") { while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()); ops.pop(); i++; prev = "n"; continue; }
      if ("+-*/".includes(c)) { if ((c === "-" || c === "+") && (prev === null || prev === "o" || prev === "(")) out.push(0); while (ops.length && "+-*/".includes(ops[ops.length - 1]) && prec[ops[ops.length - 1]] >= prec[c]) out.push(ops.pop()); ops.push(c); i++; prev = "o"; continue; }
      return 0;
    }
    while (ops.length) out.push(ops.pop());
    const st = []; for (const tk of out) { if (typeof tk === "number") st.push(tk); else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) return 0; st.push(tk === "+" ? a + b : tk === "-" ? a - b : tk === "*" ? a * b : b === 0 ? 0 : a / b); } }
    return st.length === 1 && isFinite(st[0]) ? st[0] : 0;
  } catch { return 0; }
}
function compAmount(c, raw, base) { const x = parseFloat(raw) || 0; return c.inputKind === "formula" ? evalFormula(c.formula, { x, base }) : x; }
function salaryTotal(base, inputs, comps) { return comps.reduce((t, c) => { const a = compAmount(c, inputs[c.name], base); return t + (c.kind === "deduction" ? -a : a); }, base); }
function monthLabel(m) { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" }); }
const money = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n || 0);
function fmtDur(sec) { const s = Number(sec) || 0; if (s < 3600) return "<1h"; if (s < 86400) return Math.round(s / 3600) + "h"; return Math.round(s / 86400) + "d"; }

/* ===== Salaries (monthly) ===== */
function SalariesPage({ month, setMonth, country, city, role, notify }) {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const canEditAmounts = role === "admin";
  function load() {
    setData(null); setEdits({});
    api.get(`/accounting/salaries?month=${month}&country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}`)
      .then(setData).catch((e) => notify(e.message));
  }
  useEffect(load, [month, country, city]);
  const inputsOf = (r) => edits[r.employeeId] || r.inputs || {};
  const setInput = (r, name, v) => setEdits((e) => ({ ...e, [r.employeeId]: { ...inputsOf(r), [name]: v } }));
  async function save(id) {
    const r = data.rows.find((x) => x.employeeId === id);
    try { await api.put(`/accounting/salaries/${id}`, { month, inputs: inputsOf(r) }); notify("Saved"); load(); }
    catch (e) { notify(e.message); }
  }
  async function saveAll() {
    const ids = Object.keys(edits);
    if (!ids.length) { notify("No changes to save"); return; }
    let saved = 0;
    try {
      for (const id of ids) { await api.put(`/accounting/salaries/${id}`, { month, inputs: edits[id] }); saved++; }
      notify(`Saved ${saved} employee${saved === 1 ? "" : "s"}`); load();
    } catch (e) { notify(`Saved ${saved}; then failed: ${e.message}`); load(); }
  }
  async function transfer(id) { try { await api.post(`/accounting/salaries/${id}/transfer`, { month }); notify("Transferred"); load(); } catch (e) { notify(e.message); } }
  async function transferAll() {
    try { const r = await api.post("/accounting/salaries/transfer-all", { month, country, city }); notify(r.count ? `Transferred ${r.count}` : "Nothing ready to transfer"); load(); }
    catch (e) { notify(e.message); }
  }
  async function dispatch(id) { try { const d = await api.post(`/accounting/salaries/${id}/dispatch`, { month }); const de = d.delivery || {}; notify(de.sent ? "Breakdown sent on WhatsApp" : de.error ? `Not sent: ${de.error}` : "WhatsApp not configured"); } catch (e) { notify(e.message); } }
  async function payCash(id) { if (!window.confirm("Send this salary to Pending payments as a cash settlement (with signature)?")) return; try { const r = await api.post(`/accounting/salaries/${id}/cash`, { month }); notify(`Sent to pending payments (AED ${money(r.amount)})`); } catch (e) { notify(e.message); } }
  async function dispatchAll() { if (!window.confirm("Send the salary breakdown to every employee in this city on WhatsApp?")) return; try { const r = await api.post("/accounting/salaries/dispatch-all", { month, country, city }); notify(`Sent ${r.sent} of ${r.total}${r.skipped ? `, ${r.skipped} skipped` : ""}`); } catch (e) { notify(e.message); } }
  const comps = data ? data.components : [];
  const anyReady = data && data.rows.some((r) => r.status === "ready" || r.status === "draft");
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">Monthly salaries for the selected city. Base salary is set on each employee's profile and shown here read-only; fill bonuses and deductions, then transfer. Formula columns compute automatically from the value you enter.</p>
        <div className="row-actions">
          <div className="month-nav">
            <button onClick={() => setMonth(shiftMonth(month, -1))}><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
            <span>{monthLabel(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
          </div>
          {canEditAmounts && <button className="btn btn-ghost" disabled={Object.keys(edits).length === 0} onClick={saveAll}><CheckCircle2 size={15} /> Save all{Object.keys(edits).length ? ` (${Object.keys(edits).length})` : ""}</button>}
          <button className="btn btn-ghost" onClick={dispatchAll}><MessageSquarePlus size={15} /> Dispatch breakdown all</button>
          <button className="btn btn-primary" disabled={!anyReady} onClick={transferAll}><Wallet size={15} /> Transfer all</button>
        </div>
      </div>
      {!data ? <Empty>Loading</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Employee</th><th className="ta-r">Base</th>
              {comps.map((c) => <th key={c.name} className="ta-r" title={c.inputKind === "formula" ? `Formula: ${c.formula}` : ""}>{c.name}{c.kind === "deduction" ? " −" : ""}{c.inputKind === "formula" ? " ƒ" : ""}</th>)}
              <th className="ta-r">Total</th><th>Status</th><th className="ta-r">Action</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const inp = inputsOf(r); const locked = r.status === "transferred" || !canEditAmounts;
                return (
                  <tr key={r.employeeId} style={{ cursor: "default" }}>
                    <td><div className="cell-person"><Avatar name={r.name} sm /><div><div className="cp-name">{r.name}</div><div className="cp-id">{r.position}</div></div></div></td>
                    <td className="ta-r mono base-cell">{money(r.base)}</td>
                    {comps.map((c) => {
                      const amt = compAmount(c, inp[c.name], r.base);
                      return (
                        <td key={c.name} className="ta-r">
                          <input className="num-input" disabled={locked} value={inp[c.name] ?? ""} placeholder={c.inputKind === "formula" ? "qty" : "0"} onChange={(e) => setInput(r, c.name, e.target.value)} />
                          {c.inputKind === "formula" && (inp[c.name] ? <div className={"calc-amt" + (c.kind === "deduction" ? " neg" : "")}>{c.kind === "deduction" ? "−" : ""}{money(amt)}</div> : null)}
                        </td>
                      );
                    })}
                    <td className="ta-r mono" style={{ fontWeight: 600 }}>{money(salaryTotal(r.base, inp, comps))}</td>
                    <td><Badge tone={r.status === "transferred" ? "success" : r.status === "ready" ? "info" : "neutral"}>{r.status}</Badge></td>
                    <td className="ta-r"><div className="row-actions">
                      {canEditAmounts && r.status !== "transferred" && <button className="btn btn-sm btn-ghost" onClick={() => save(r.employeeId)}>Save</button>}
                      {r.status === "ready" && <button className="btn btn-sm btn-primary" onClick={() => transfer(r.employeeId)}>Transfer</button>}
                      {r.status === "transferred" && <span className="muted sm">Paid</span>}
                      {r.status === "draft" && !canEditAmounts && <span className="muted sm">Not set</span>}
                      <button className="btn btn-sm btn-ghost" title="Send this breakdown to the employee on WhatsApp" onClick={() => dispatch(r.employeeId)}><MessageSquarePlus size={12} /> Dispatch breakdown</button>
                      <button className="btn btn-sm btn-ghost" title="Send to Pending payments as a cash settlement with signature" onClick={() => payCash(r.employeeId)}><Wallet size={12} /> Pay cash</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.rows.length === 0 && <Empty>No employees in the selected city.</Empty>}
          {comps.length === 0 && <div className="warn-inline" style={{ margin: 12 }}>No salary components yet. Add bonuses and deductions in Setup.</div>}
        </div>
      )}
    </div>
  );
}

/* ===== Pending payments (rejected trainees) ===== */
function PendingPaymentsPage({ country, city, role, notify }) {
  const [rows, setRows] = useState(null);
  const [links, setLinks] = useState(null); // { employeeLink, managerLink, delivery } to display
  const [sending, setSending] = useState(null); // id being sent
  const [tab, setTab] = useState("pending");
  function load() { api.get(`/accounting/pending-payments?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}`).then(setRows).catch((e) => notify(e.message)); }
  useEffect(load, [country, city]);
  async function pay(id) { if (!window.confirm("Mark paid without signatures? This is a manual override.")) return; try { await api.post(`/accounting/pending-payments/${id}/pay`); notify("Marked paid"); load(); } catch (e) { notify(e.message); } }
  async function showLinks(id) { try { const d = await api.get(`/accounting/pending-payments/${id}/links`); setLinks(d); } catch (e) { notify(e.message); } }
  async function openSignedPdf(id) {
    try { const res = await fetch(`/api/accounting/pending-payments/${id}/signed.pdf`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank"); else notify("Could not open the signed PDF"); }
    catch { notify("Could not open the signed PDF"); }
  }
  async function send(id) {
    setSending(id);
    try {
      const d = await api.post(`/accounting/pending-payments/${id}/send`, {});
      setLinks(d); load();
      const de = d.delivery || {};
      const okAll = de.employee && de.employee.sent && de.manager && de.manager.sent;
      const anyErr = (de.employee && de.employee.error) || (de.manager && de.manager.error);
      notify(okAll ? "WhatsApp messages sent" : anyErr ? `WhatsApp not sent: ${anyErr} — share the links manually` : "Links created — share manually (WhatsApp not configured)");
    } catch (e) { notify(e.message); } finally { setSending(null); }
  }
  const statusTone = (s) => (s === "paid" ? "success" : s === "awaiting" ? "info" : "warning");
  const shown = (rows || []).filter((r) => tab === "paid" ? r.status === "paid" : r.status !== "paid");
  return (
    <div className="stack">
      <p className="blurb">People who trained or trialled and were not hired are owed for the days worked. Send a settlement for signature: the employee and the manager each get a WhatsApp link to sign online. Once both sign, it is settled automatically and a signed PDF is stored.</p>
      <div className="tabbar">
        <button className={"tab" + (tab === "pending" ? " on" : "")} onClick={() => setTab("pending")}>Pending{rows ? ` (${rows.filter((r) => r.status !== "paid").length})` : ""}</button>
        <button className={"tab" + (tab === "paid" ? " on" : "")} onClick={() => setTab("paid")}>Paid{rows ? ` (${rows.filter((r) => r.status === "paid").length})` : ""}</button>
      </div>
      {!rows ? <Empty>Loading</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Person</th><th className="ta-r">Days</th><th className="ta-r">Amount</th><th>Signatures</th><th>Status</th><th className="ta-r">Action</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td><div className="cell-person"><Avatar name={r.name} sm /><div><div className="cp-name">{r.name}</div><div className="cp-id">{r.position}</div></div></div></td>
                  <td className="ta-r mono">{r.days}</td>
                  <td className="ta-r mono" style={{ fontWeight: 600 }}>{money(r.amount)}</td>
                  <td className="sm">{r.status === "pending" ? <span className="muted">not sent</span> : <span className="sig-state"><span className={r.employeeSigned ? "sig-yes" : "sig-no"}>{r.employeeSigned ? "✓" : "○"} employee</span><span className={r.managerSigned ? "sig-yes" : "sig-no"}>{r.managerSigned ? "✓" : "○"} manager</span></span>}</td>
                  <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td className="ta-r"><div className="row-actions">
                    {r.status === "pending" && <button className="btn btn-sm btn-primary" disabled={sending === r.id} onClick={() => send(r.id)}><Wallet size={13} /> {sending === r.id ? "Sending" : "Send for signature"}</button>}
                    {r.status === "awaiting" && <><button className="btn btn-sm btn-ghost" onClick={() => showLinks(r.id)}>View links</button><button className="btn btn-sm btn-ghost" disabled={sending === r.id} onClick={() => send(r.id)}>Resend</button></>}
                    {r.status === "paid" && r.hasPdf && <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); openSignedPdf(r.id); }}>Signed PDF</button>}
                    {r.status !== "paid" && role === "admin" && <button className="btn btn-sm btn-ghost" onClick={() => pay(r.id)} title="Manual override">Mark paid</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty>No {tab} payments in the selected city.</Empty>}
        </div>
      )}
      {links && <LinksModal links={links} onClose={() => setLinks(null)} notify={notify} />}
    </div>
  );
}

function LinksModal({ links, onClose, notify }) {
  const copy = (t) => { navigator.clipboard?.writeText(t).then(() => notify("Link copied")).catch(() => {}); };
  const del = links.delivery || {};
  const status = (d) => !d ? "" : d.sent ? "sent via WhatsApp" : d.suppressed ? "WhatsApp not configured" : `not sent (${d.error || "error"})`;
  const tone = (d) => !d ? "muted" : d.sent ? "sig-yes" : "deducted-tag";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Signature links</div><h3>Share these links</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="setup-hint">Send each link to the right person. Each opens a login-free page to sign. Once both sign, the payment settles automatically. If WhatsApp delivery fails, copy the link and send it yourself.</p>
        <div className="link-row"><div><div className="link-label">Employee {links.employeePhone ? `· ${links.employeePhone}` : ""} {links.employeeSigned ? "· signed ✓" : ""}</div><div className="link-url">{links.employeeLink}</div>{del.employee && <div className={"sm " + tone(del.employee)}>{status(del.employee)}</div>}</div><button className="btn btn-sm btn-ghost" onClick={() => copy(links.employeeLink)}>Copy</button></div>
        <div className="link-row"><div><div className="link-label">Manager {links.managerPhone ? `· ${links.managerPhone}` : ""} {links.managerSigned ? "· signed ✓" : ""}</div><div className="link-url">{links.managerLink}</div>{del.manager && <div className={"sm " + tone(del.manager)}>{status(del.manager)}</div>}</div><button className="btn btn-sm btn-ghost" onClick={() => copy(links.managerLink)}>Copy</button></div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
      </div>
    </>
  );
}

/* ===== Interview calendar ===== */
function CalendarPage({ role, notify, onChanged }) {
  const [cals, setCals] = useState(null);
  useEffect(() => { api.get("/calendars").then((c) => { setCals(c); onChanged && onChanged(); }).catch((e) => notify(e.message)); }, []);
  if (!cals) return <div className="stack"><Empty>Loading</Empty></div>;
  return (
    <div className="stack">
      <p className="blurb">Managers set the days and times they can interview. HR books a free slot when scheduling a candidate.</p>
      {cals.length === 0 && <Empty>No calendars yet. An admin can create one in Setup and attach it to a user.</Empty>}
      <div className="cal-grid">
        {cals.map((c) => <CalendarCard key={c.id} cal={c} role={role} notify={notify} />)}
      </div>
    </div>
  );
}
function CalendarCard({ cal, role, notify }) {
  const [slots, setSlots] = useState(null);
  const [d, setD] = useState(""); const [t, setT] = useState("");
  const manage = cal.mine || role === "admin";
  function load() { api.get(`/calendars/${cal.id}/slots`).then(setSlots).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function add() { if (!d || !t) return; try { await api.post(`/calendars/${cal.id}/slots`, { date: d, time: t }); setD(""); setT(""); load(); } catch (e) { notify(e.message); } }
  async function del(id) { try { await api.del(`/calendars/${cal.id}/slots/${id}`); load(); } catch (e) { notify(e.message); } }
  return (
    <section className="panel cal-card">
      <div className="panel-h"><h3>{cal.name}</h3><span className="muted sm">{cal.ownerName}{cal.mine ? " (you)" : ""}</span></div>
      {manage && (
        <div className="setup-add" style={{ marginBottom: 14 }}>
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          <input type="time" value={t} onChange={(e) => setT(e.target.value)} />
          <button className="btn btn-sm btn-primary" onClick={add}><Plus size={14} /> Add slot</button>
        </div>
      )}
      <div className="slot-list">
        {(slots || []).map((s) => (
          <div className={"slot" + (s.booked ? " slot-booked" : "") + (s.past ? " slot-past" : "")} key={s.id}>
            <CalendarClock size={14} />
            <span className="slot-when">{new Date(s.date).toISOString().slice(0, 10)} · {s.time}</span>
            {s.booked ? <span className="slot-tag">{s.candidateName}</span> : s.past ? <span className="slot-free">expired</span> : <span className="slot-free">free</span>}
            {manage && !s.booked && <button className="slot-x" onClick={() => del(s.id)}><X size={13} /></button>}
          </div>
        ))}
        {slots && slots.length === 0 && <span className="muted sm">No availability yet.</span>}
      </div>
    </section>
  );
}

/* ===== Schedule interview modal ===== */
function ScheduleModal({ candidate, onClose, onConfirm, notify }) {
  const [cals, setCals] = useState([]);
  const [calId, setCalId] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotId, setSlotId] = useState("");
  useEffect(() => { api.get("/calendars").then((cs) => { setCals(cs); if (cs[0]) setCalId(String(cs[0].id)); }).catch((e) => notify(e.message)); }, []);
  useEffect(() => { if (calId) api.get(`/calendars/${calId}/slots`).then((ss) => setSlots(ss.filter((s) => !s.booked && !s.past))).catch(() => setSlots([])); }, [calId]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Schedule interview</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        {cals.length === 0 ? (
          <>
            <p className="modal-sub">No interview calendars exist yet. You can still move this candidate to the interview stage without a time.</p>
            <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onConfirm(candidate.id, null)}>Schedule without a time</button></div>
          </>
        ) : (
          <>
            <label className="field"><span>Manager</span>
              <select value={calId} onChange={(e) => setCalId(e.target.value)}>{cals.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.ownerName})</option>)}</select></label>
            <label className="field"><span>Available slot</span>
              <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                <option value="">Select a day and time</option>
                {slots.map((s) => <option key={s.id} value={s.id}>{new Date(s.date).toISOString().slice(0, 10)} · {s.time}</option>)}
              </select></label>
            {slots.length === 0 && <div className="warn-inline">This manager has no free slots. Pick another, or ask them to add availability.</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!slotId} onClick={() => onConfirm(candidate.id, Number(slotId))}>Book interview</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ===== Reject modal (creates a pending payment) ===== */
function RejectModal({ candidate, onClose, onConfirm }) {
  const [days, setDays] = useState("");
  const autoRate = candidate.salary ? candidate.salary / 30.416 : 0;
  const [reason, setReason] = useState("");
  const [notifyCand, setNotifyCand] = useState(false);
  const amount = (parseFloat(days) || 0) * autoRate;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Reject</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-sub">They worked some days during trial or training and are owed for them. This logs a pending payment for the accountant. The daily rate is calculated from the salary automatically.</p>
        <div className="add-grid">
          <label className="field"><span>Days worked</span><input className="num-input" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="field"><span>Daily rate (auto)</span><input className="num-input" value={autoRate ? money(autoRate) : "—"} disabled /></label>
          <label className="field"><span>Amount owed</span><input className="num-input" value={money(amount)} disabled /></label>
        </div>
        <label className="field"><span>Reason (optional)</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="check-row" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={notifyCand} onChange={(e) => setNotifyCand(e.target.checked)} />
          <span className="sm">Notify the candidate on WhatsApp that they were not selected{candidate.phone ? "" : " (no number on file)"}</span>
        </label>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={!(parseFloat(days) >= 0 && days !== "")} onClick={() => onConfirm(candidate.id, { days: parseInt(days, 10), reason, notify: notifyCand })}>Reject and log payment</button>
        </div>
      </div>
    </>
  );
}

/* ===== WhatsApp (respond.io) integration settings ===== */
function WhatsAppSettings({ notify }) {
  const [cfg, setCfg] = useState(null);
  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [managerPhone, setManagerPhone] = useState("");
  const [procurementPhone, setProcurementPhone] = useState("");
  const [hrPhone, setHrPhone] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("");
  function load() { api.get("/settings/respondio").then((d) => { setCfg(d); setChannelId(d.channelId || ""); setManagerPhone(d.managerPhone || ""); setProcurementPhone(d.procurementPhone || ""); setHrPhone(d.hrPhone || ""); setTemplateName(d.templateName || ""); setTemplateLang(d.templateLang || ""); }).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function save() {
    try { await api.put("/settings/respondio", { token: token || undefined, channelId, managerPhone, procurementPhone, hrPhone, templateName, templateLang }); setToken(""); notify("WhatsApp settings saved"); load(); }
    catch (e) { notify(e.message); }
  }
  return (
    <section className="panel setup-panel">
      <div className="panel-h"><h3>WhatsApp (respond.io)</h3>{cfg && <Badge tone={cfg.tokenSet ? "success" : "neutral"}>{cfg.tokenSet ? "connected" : "not set"}</Badge>}</div>
      <p className="setup-hint">Used to send settlement signature links over WhatsApp. Enter your respond.io Developer API token and channel ID once — they are stored with the app and carry over if you move servers. The manager (payer) number below is used automatically for every settlement, so it never has to be typed in. The template name and language must match your approved template in respond.io exactly (case-sensitive). Tip: in respond.io open the template, use Actions, Copy API Payload, and copy the exact name and language code from there.</p>
      <div className="add-grid">
        <label className="field"><span>Developer API token {cfg && cfg.tokenSet ? "(set — leave blank to keep)" : ""}</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg && cfg.tokenSet ? "••••••••" : "paste token"} /></label>
        <label className="field"><span>WhatsApp channel ID (optional)</span><input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="e.g. 12345" /></label>
        <label className="field"><span>Manager (payer) WhatsApp number</span><input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} placeholder="+9715XXXXXXXX" /></label>
        <label className="field"><span>Procurement manager WhatsApp number</span><input value={procurementPhone} onChange={(e) => setProcurementPhone(e.target.value)} placeholder="+9715XXXXXXXX" /></label>
        <label className="field"><span>HR WhatsApp number</span><input value={hrPhone} onChange={(e) => setHrPhone(e.target.value)} placeholder="+9715XXXXXXXX" /></label>
        <label className="field"><span>Settlement template name</span><input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="settlement_signature" /></label>
        <label className="field"><span>Template language code</span><input value={templateLang} onChange={(e) => setTemplateLang(e.target.value)} placeholder="en_US" /></label>
        <div className="field" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
      <p className="setup-hint" style={{ marginTop: 8 }}>The settlement template uses 4 body variables in order: employee name, amount, role (receiver/payer), and the signing link. Use full international format for the number, e.g. +9715XXXXXXXX.</p>
    </section>
  );
}

/* ===== Calendars manager (Setup) ===== */
function CalendarsSetup({ notify }) {
  const [cals, setCals] = useState(null);
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ name: "", userId: "", phone: "", startHour: 8, endHour: 18, slotMinutes: 60 });
  function load() { api.get("/calendars").then(setCals).catch((e) => notify(e.message)); }
  useEffect(() => { load(); api.get("/users").then((u) => { setUsers(u); if (u[0]) setF((s) => ({ ...s, userId: String(u[0].id) })); }).catch(() => {}); }, []);
  async function add() { if (!f.name || !f.userId) return; try { await api.post("/calendars", { ...f, userId: Number(f.userId) }); setF({ ...f, name: "" }); load(); } catch (e) { notify(e.message); } }
  async function del(id) { try { await api.del(`/calendars/${id}`); load(); } catch (e) { notify(e.message); } }
  async function patch(id, body) { try { await api.patch(`/calendars/${id}`, body); load(); } catch (e) { notify(e.message); } }
  const hours = Array.from({ length: 25 }, (_, i) => i);
  return (
    <section className="panel setup-panel">
      <div className="panel-h"><h3>Interview calendars</h3></div>
      <p className="setup-hint">Create a calendar and attach it to a user. Set working hours and slot length; the owner manages availability and HR books slots when scheduling. Add the interviewer's WhatsApp number to notify them when an interview is booked.</p>
      <div className="cal-setup-list">
        {(cals || []).map((c) => (
          <div className="cal-setup-row" key={c.id}>
            <div className="cal-setup-name">{c.name}<span className="muted sm"> · {c.ownerName}</span></div>
            <label className="csr-f">WhatsApp<input className="csr-phone" defaultValue={c.phone || ""} placeholder="+9715…" onBlur={(e) => { if ((e.target.value || "") !== (c.phone || "")) patch(c.id, { phone: e.target.value }); }} /></label>
            <label className="csr-f">From<select value={c.startHour} onChange={(e) => patch(c.id, { startHour: e.target.value })}>{hours.map((h) => <option key={h} value={h}>{pad2(h)}:00</option>)}</select></label>
            <label className="csr-f">To<select value={c.endHour} onChange={(e) => patch(c.id, { endHour: e.target.value })}>{hours.map((h) => <option key={h} value={h}>{pad2(h)}:00</option>)}</select></label>
            <label className="csr-f">Slot<select value={c.slotMinutes} onChange={(e) => patch(c.id, { slotMinutes: e.target.value })}><option value={60}>60 min</option><option value={30}>30 min</option><option value={15}>15 min</option></select></label>
            <button className="trash" onClick={() => del(c.id)}><X size={14} /></button>
          </div>
        ))}
        {cals && cals.length === 0 && <span className="muted sm">None yet.</span>}
      </div>
      <div className="setup-add" style={{ marginTop: 12 }}>
        <input placeholder="Calendar name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <input placeholder="WhatsApp +9715…" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <select value={f.startHour} onChange={(e) => setF({ ...f, startHour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>from {pad2(h)}:00</option>)}</select>
        <select value={f.endHour} onChange={(e) => setF({ ...f, endHour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>to {pad2(h)}:00</option>)}</select>
        <select value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: Number(e.target.value) })}><option value={60}>60 min</option><option value={30}>30 min</option><option value={15}>15 min</option></select>
        <button className="btn btn-sm btn-primary" onClick={add}><Plus size={14} /> Add</button>
      </div>
    </section>
  );
}

/* ===== Salary components (Setup): bonuses, deductions and formulas ===== */
function SalaryComponentsSetup({ notify, refreshMeta }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ name: "", kind: "bonus", inputKind: "amount", formula: "" });
  function load() { api.get("/accounting/components").then(setRows).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function add() {
    if (!f.name) return;
    try { await api.post("/accounting/components", f); setF({ name: "", kind: "bonus", inputKind: "amount", formula: "" }); load(); refreshMeta(); }
    catch (e) { notify(e.message); }
  }
  async function patch(id, body) { try { await api.patch(`/accounting/components/${id}`, body); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  async function del(id) { try { await api.del(`/accounting/components/${id}`); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  return (
    <section className="panel setup-panel setup-wide">
      <div className="panel-h"><h3>Salary components</h3></div>
      <p className="setup-hint">Columns on the salaries sheet. A component is a bonus (added) or deduction (subtracted). Choose Amount to type the value directly, or Formula to compute it from the value you enter. Formulas may use <code>x</code> (the value entered that month) and <code>base</code> (the employee's base salary), with + − × ÷ and brackets. Examples: Google reviews → <code>x * 10</code>; overtime day → <code>base / 30.418 * x</code>.</p>
      <div className="cal-setup-list">
        {(rows || []).map((r) => (
          <div className="cal-setup-row comp-row" key={r.id}>
            <div className="cal-setup-name">{r.name}</div>
            <label className="csr-f">Type<select value={r.kind} onChange={(e) => patch(r.id, { kind: e.target.value, inputKind: r.inputKind, formula: r.formula })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select></label>
            <label className="csr-f">Input<select value={r.inputKind} onChange={(e) => patch(r.id, { kind: r.kind, inputKind: e.target.value, formula: r.formula })}><option value="amount">Amount</option><option value="formula">Formula</option></select></label>
            {r.inputKind === "formula" && <input className="formula-input" defaultValue={r.formula} placeholder="e.g. x * 10" onBlur={(e) => e.target.value !== r.formula && patch(r.id, { kind: r.kind, inputKind: "formula", formula: e.target.value })} />}
            <button className="trash" onClick={() => del(r.id)}><X size={14} /></button>
          </div>
        ))}
        {rows && rows.length === 0 && <span className="muted sm">None yet.</span>}
      </div>
      <div className="setup-add comp-add" style={{ marginTop: 12 }}>
        <input placeholder="Component name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select>
        <select value={f.inputKind} onChange={(e) => setF({ ...f, inputKind: e.target.value })}><option value="amount">Amount</option><option value="formula">Formula</option></select>
        {f.inputKind === "formula" && <input className="formula-input" placeholder="formula, e.g. base / 30.418 * x" value={f.formula} onChange={(e) => setF({ ...f, formula: e.target.value })} />}
        <button className="btn btn-sm btn-primary" onClick={add}><Plus size={14} /> Add</button>
      </div>
    </section>
  );
}

/* ===== Uniform items (Setup): name + default quantity per new hire ===== */
function UniformItemsSetup({ notify, refreshMeta }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ name: "", default_qty: 1 });
  function load() { api.get("/config/uniform-items").then(setRows).catch((e) => notify(e.message)); }
  useEffect(load, []);
  async function add() { if (!f.name) return; try { await api.post("/config/uniform-items", f); setF({ name: "", default_qty: 1 }); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  async function patchQty(id, v) { try { await api.patch(`/config/uniform-items/${id}`, { default_qty: v }); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  async function del(id) { try { await api.del(`/config/uniform-items/${id}`); load(); refreshMeta(); } catch (e) { notify(e.message); } }
  return (
    <section className="panel setup-panel">
      <div className="panel-h"><h3>Uniform items</h3></div>
      <p className="setup-hint">Items available to order in procurement. The default quantity is what each new hire automatically gets when they pass Medical & Tawjeeh.</p>
      <div className="cal-setup-list">
        {(rows || []).map((r) => (
          <div className="cal-setup-row" key={r.id}>
            <div className="cal-setup-name">{r.name}</div>
            <label className="csr-f">Default per hire<input className="num-input wo-qty" defaultValue={r.default_qty} onBlur={(e) => Number(e.target.value) !== r.default_qty && patchQty(r.id, e.target.value)} /></label>
            <button className="trash" onClick={() => del(r.id)}><X size={14} /></button>
          </div>
        ))}
        {rows && rows.length === 0 && <span className="muted sm">None yet.</span>}
      </div>
      <div className="setup-add" style={{ marginTop: 12 }}>
        <input placeholder="Item name (e.g. Cap)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="num-input" placeholder="Default qty" value={f.default_qty} onChange={(e) => setF({ ...f, default_qty: e.target.value })} style={{ width: 110 }} />
        <button className="btn btn-sm btn-primary" onClick={add}><Plus size={14} /> Add item</button>
      </div>
    </section>
  );
}

/* ===== Trial modal (Interview -> Trial) ===== */
function TrialModal({ candidate, onClose, onConfirm }) {
  const meta = useMeta();
  const whs = warehousesFor(meta, candidate.city);
  const [f, setF] = useState({ startDate: candidate.startDate || "", trialDays: "", warehouse: candidate.warehouse !== "-" ? candidate.warehouse : (whs[0] || ""), salary: candidate.salary || "", notes: candidate.trialNotes || "" });
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Move to trial</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-sub">Set the trial details. These prefill the offer later. The candidate gets a WhatsApp with the start date and trial length.</p>
        <div className="add-grid">
          <label className="field"><span>Start date</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="field"><span>Trial period (days)</span><input inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} placeholder="e.g. 5" /></label>
          <label className="field"><span>Warehouse</span>
            <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
              <option value="">Select</option>{whs.map((w) => <option key={w}>{w}</option>)}
            </select></label>
          <label className="field"><span>Salary (AED/month)</span><input className="num-input" style={{ width: "100%" }} value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></label>
        </div>
        <label className="field"><span>Notes</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onConfirm(candidate.id, f)}>Start trial</button></div>
      </div>
    </>
  );
}

/* ===== Offer modal (Trial -> Offer, or edit) ===== */
function OfferModal({ candidate, edit, onClose, onConfirm }) {
  const meta = useMeta();
  const whs = warehousesFor(meta, candidate.city);
  const [f, setF] = useState({ salary: candidate.salary || "", startDate: candidate.startDate || "", warehouse: candidate.warehouse !== "-" ? candidate.warehouse : (whs[0] || "") });
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">{edit ? "Edit offer" : "Make offer"}</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-sub">These terms appear on the generated offer letter.</p>
        <div className="add-grid">
          <label className="field"><span>Salary (AED/month)</span><input className="num-input" style={{ width: "100%" }} value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></label>
          <label className="field"><span>Start date</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="field"><span>Warehouse</span>
            <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
              <option value="">Select</option>{whs.map((w) => <option key={w}>{w}</option>)}
            </select></label>
        </div>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onConfirm(candidate.id, f, edit)}>{edit ? "Save offer" : "Make offer"}</button></div>
      </div>
    </>
  );
}

/* ===== Shortlist modal (with notes) ===== */
function ShortlistModal({ candidate, onClose, onConfirm }) {
  const [notes, setNotes] = useState(candidate.shortlistNotes || "");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">Shortlist</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-sub">Keep this candidate for later with a note on why.</p>
        <label className="field"><span>Notes</span><input autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onConfirm(candidate.id, notes)} /></label>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onConfirm(candidate.id, notes)}>Shortlist</button></div>
      </div>
    </>
  );
}

/* ===== Reason modal (reject offer) ===== */
function ReasonModal({ title, candidate, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-h"><div><div className="eyebrow">{title}</div><h3>{candidate.name}</h3></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <label className="field"><span>Reason</span><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onConfirm(candidate.id, reason)} /></label>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-danger" onClick={() => onConfirm(candidate.id, reason)}>{title}</button></div>
      </div>
    </>
  );
}

/* ===== Weekly interview calendar (Google-calendar style) ===== */
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function mondayOf(dt) { const x = new Date(dt); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function CalendarView({ calendarId, calendars, role, notify, onOpenCandidate }) {
  const cal = calendars.find((c) => c.id === calendarId);
  const manage = (cal && cal.mine) || role === "admin";
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [slots, setSlots] = useState([]);
  function load() { api.get(`/calendars/${calendarId}/slots`).then(setSlots).catch((e) => notify(e.message)); }
  useEffect(load, [calendarId]);

  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const startHour = cal?.startHour ?? 8, endHour = cal?.endHour ?? 18, slotMin = cal?.slotMinutes ?? 60;
  const times = [];
  for (let m = startHour * 60; m < endHour * 60; m += slotMin) times.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  const slotAt = (ds, tm) => slots.find((s) => String(s.date).slice(0, 10) === ds && s.time === tm);

  async function cellClick(ds, tm, slot) {
    if (slot && slot.booked) { onOpenCandidate(slot.candidateId); return; }
    if (!manage) return;
    try {
      if (slot) await api.del(`/calendars/${calendarId}/slots/${slot.id}`);
      else await api.post(`/calendars/${calendarId}/slots`, { date: ds, time: tm });
      load();
    } catch (e) { notify(e.message); }
  }

  const label = `${isoLocal(days[0])} to ${isoLocal(days[6])}`;
  const cells = [];
  cells.push(<div className="cal-corner" key="corner" />);
  days.forEach((d, i) => cells.push(<div className="cal-dayhead" key={"h" + i}><span className="cal-wd">{WD[i]}</span><span className="cal-dn">{d.getDate()}</span></div>));
  times.forEach((tm) => {
    cells.push(<div className="cal-time" key={"t" + tm}>{tm}</div>);
    days.forEach((d) => {
      const ds = isoLocal(d);
      const slot = slotAt(ds, tm);
      let cls = "cal-cell", inner = null, title = "";
      if (slot && slot.booked) { cls += " c-booked"; inner = <><span className="cc-name">{slot.candidateName}</span><span className="cc-role">{slot.candidateRole}</span></>; title = "Open candidate"; }
      else if (slot) { cls += " c-free"; inner = <span className="cc-free">Available</span>; title = manage ? "Click to close" : "Available"; }
      else if (manage) { cls += " c-open"; inner = <span className="cc-plus">+</span>; title = "Click to open availability"; }
      else cls += " c-empty";
      cells.push(<div className={cls} key={ds + tm} title={title} onClick={() => cellClick(ds, tm, slot)}>{inner}</div>);
    });
  });

  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">{manage ? "Click an empty cell to open availability, click again to close it. Booked interviews show the candidate; click to view and record the outcome." : "This manager's availability and booked interviews. Book a slot from an applicant's Schedule interview."}</p>
        <div className="cal-toolbar">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
          <button className="cal-today" onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
          <span className="cal-range">{label}</span>
        </div>
      </div>
      <div className="cal-week">{cells}</div>
      <div className="cal-legend"><span className="lg c-free" /> Available <span className="lg c-booked" /> Booked <span className="lg c-open" /> Open a slot</div>
    </div>
  );
}

/* ===== Reusable documents panel (used in profile + doc processing) ===== */
function DocumentsPanel({ employeeId, labels }) {
  const [docs, setDocs] = useState(null);
  const [form, setForm] = useState({ label: labels[0] || "Other", custom: "", expiry: "", file: null });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  function load() { api.get(`/candidates/${employeeId}/documents`).then(setDocs).catch((e) => setErr(e.message)); }
  useEffect(load, [employeeId]);
  async function upload() {
    const label = form.label === "Other" ? form.custom.trim() : form.label;
    if (!label || !form.file) { setErr("Pick a type and a file"); return; }
    setBusy(true); setErr("");
    const fd = new FormData(); fd.append("label", label); fd.append("file", form.file); if (form.expiry) fd.append("expiry", form.expiry);
    try { await api.postForm(`/candidates/${employeeId}/documents`, fd); setForm({ label: labels[0] || "Other", custom: "", expiry: "", file: null }); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function download(d) { const res = await fetch(`/api/candidates/${employeeId}/documents/${d.id}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank"); }
  async function del(id) { try { await api.del(`/candidates/${employeeId}/documents/${id}`); load(); } catch (e) { setErr(e.message); } }
  const opts = [...labels, "Other"];
  return (
    <div>
      {err && <div className="login-err">{err}</div>}
      <div className="doc-upload">
        <select value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
        {form.label === "Other" && <input placeholder="Document name" value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} />}
        <input type="date" title="Expiry (optional)" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
        <input type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] || null })} />
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={upload}><Plus size={14} /> Upload</button>
      </div>
      <div className="doc-list">
        {(docs || []).map((d) => (
          <div className="doc-row" key={d.id}>
            <FileText size={15} className="muted" />
            <div className="doc-main"><div className="doc-label">{d.label}</div><div className="doc-sub">{d.filename}{d.expiry ? ` · expires ${d.expiry}` : ""}</div></div>
            <button className="btn btn-sm btn-ghost" onClick={() => download(d)}>Open</button>
            <button className="trash" onClick={() => del(d.id)}><Trash2 size={14} /></button>
          </div>
        ))}
        {docs && docs.length === 0 && <Empty>No documents uploaded yet.</Empty>}
      </div>
    </div>
  );
}

/* ===== Employee profile with tabs ===== */
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function ProfilePage({ employeeId, role, notify, onBack }) {
  const meta = useMeta();
  const docLabels = meta.phases.find((p) => p.key === "Documentation").stages;
  const [data, setData] = useState(null);
  const [p, setP] = useState(null);
  const [baseSalary, setBaseSalary] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [sizes, setSizes] = useState({ tshirtSize: "", pantsSize: "", shoeSize: "" });
  const [editCore, setEditCore] = useState({ position: "", warehouse: "", startDate: "" });
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [tab, setTab] = useState("details");
  const [leave, setLeave] = useState({ startDate: "", endDate: "", days: "", type: "Annual", status: "Planned" });
  const [comp, setComp] = useState({ date: "", days: 1, note: "" });
  const [newContractForm, setNewContractForm] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [viewContractId, setViewContractId] = useState(null);
  useEffect(() => { setViewContractId(null); setNewContractForm(null); setSettlement(null); }, [employeeId]);
  function load() { api.get(`/candidates/${employeeId}/profile`).then((d) => { setData(d); setP(d.profile); setBaseSalary(d.core.salary ?? ""); setContactEmail(d.core.email ?? ""); setContactPhone(d.core.phone ?? ""); setSizes({ tshirtSize: d.core.tshirtSize ?? "", pantsSize: d.core.pantsSize ?? "", shoeSize: d.core.shoeSize ?? "" }); setEditCore({ position: d.core.position ?? "", warehouse: d.core.warehouse && d.core.warehouse !== "-" ? d.core.warehouse : "", startDate: d.core.startDate ?? "" }); setInsuranceExpiry(d.core.insuranceExpiry ?? ""); }).catch((e) => notify(e.message)); }
  useEffect(load, [employeeId]);
  if (!data || !p) return <div className="stack"><button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button><Empty>Loading</Empty></div>;
  const c = data.core; const canEdit = data.canEdit;
  const set = (k, v) => setP({ ...p, [k]: v });
  async function save() { try { await api.put(`/candidates/${employeeId}/profile`, { ...p, salary: baseSalary, email: contactEmail, phone: contactPhone, ...sizes, position: editCore.position, warehouse: editCore.warehouse, startDate: editCore.startDate, insuranceExpiry }); notify("Profile saved"); load(); } catch (e) { notify(e.message); } }
  const leaveDays = (leave.startDate && leave.endDate) ? Math.max(0, Math.round((new Date(leave.endDate) - new Date(leave.startDate)) / 86400000) + 1) : 0;
  async function addLeave() { if (leaveDays <= 0) return; try { await api.post(`/candidates/${employeeId}/leaves`, { ...leave, days: leaveDays }); setLeave({ startDate: "", endDate: "", days: "", type: "Annual", status: "Planned" }); load(); } catch (e) { notify(e.message); } }
  async function addComp() { if (!(Number(comp.days) > 0)) { notify("Days must be > 0"); return; } try { await api.post(`/candidates/${employeeId}/compensation`, { compDate: comp.date || null, days: Number(comp.days), note: comp.note }); setComp({ date: "", days: 1, note: "" }); notify("Compensation day recorded"); load(); } catch (e) { notify(e.message); } }
  async function delComp(cid) { try { await api.del(`/candidates/${employeeId}/compensation/${cid}`); load(); } catch (e) { notify(e.message); } }
  async function setTicket(cid, status) { try { const fd = new FormData(); fd.append("status", status); await api.postForm(`/candidates/${employeeId}/contract/${cid}/ticket`, fd); notify(`Ticket marked ${status}`); load(); } catch (e) { notify(e.message); } }
  async function uploadTicket(cid, file) { try { const fd = new FormData(); fd.append("status", "taken"); fd.append("file", file); await api.postForm(`/candidates/${employeeId}/contract/${cid}/ticket`, fd); notify("Ticket attached and saved to Documents"); load(); } catch (e) { notify(e.message); } }
  async function openTicket(cid) { const res = await fetch(`/api/candidates/${employeeId}/contract/${cid}/ticket`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank"); else notify("No ticket on file"); }
  async function newContract() {
    if (!newContractForm?.startDate || !newContractForm?.endDate || newContractForm.endDate < newContractForm.startDate) { notify("Enter a valid start and end date"); return; }
    try {
      const r = await api.post(`/candidates/${employeeId}/contract/new`, newContractForm);
      setNewContractForm(null); setViewContractId(null);
      setLeave({ startDate: "", endDate: "", days: "", type: "Annual", status: "Planned" });
      setComp({ date: "", days: 1, note: "" });
      notify(`New contract started. Previous had ${r.previousUnused} unused day(s).`); load();
    } catch (e) { notify(e.message); }
  }
  async function settleContract() {
    const d = Number(settlement?.days);
    if (!Number.isFinite(d) || d <= 0 || d > settlement.remaining) { notify(`Enter up to ${settlement.remaining} days`); return; }
    if (settlement.kind === "used" && (!settlement.startDate || !settlement.endDate || settlement.endDate < settlement.startDate)) { notify("Enter the vacation dates"); return; }
    try { await api.post(`/candidates/${employeeId}/contract/${settlement.id}/settle`, settlement.kind === "used" ? { used: d, startDate: settlement.startDate, endDate: settlement.endDate } : { reimbursed: d }); setSettlement(null); notify("Recorded"); load(); } catch (e) { notify(e.message); }
  }
  async function delLeave(id) { try { await api.del(`/candidates/${employeeId}/leaves/${id}`); load(); } catch (e) { notify(e.message); } }
  const tabs = [["details", "Details"], ["documents", "Documents"], ["uniform", "Uniform"], ["vacations", "Vacations"]];
  const ls = data.leaveSummary;
  const viewedContract = data.contracts.find((ct) => ct.id === Number(viewContractId)) || data.contracts.find((ct) => ct.isCurrent);
  const viewingCurrent = !viewedContract || viewedContract.isCurrent;
  const visibleLeaves = data.leaves.filter((l) => l.contractId === viewedContract?.id);
  const visibleComps = data.comps.filter((x) => x.contractId === viewedContract?.id);
  const vacationRows = [
    ...visibleLeaves.map((l) => ({ key: `leave-${l.id}`, type: l.type, from: l.startDate, to: l.endDate, days: l.days, status: l.status, tone: l.status === "Taken" ? "success" : "info", note: l.notes, remove: viewingCurrent ? () => delLeave(l.id) : null })),
    ...visibleComps.map((x) => ({ key: `comp-${x.id}`, type: "Compensation", from: x.date, to: null, days: `+${x.days}`, status: "Added", tone: "success", note: [x.note, x.by].filter(Boolean).join(" · "), remove: viewingCurrent ? () => delComp(x.id) : null })),
    ...(viewedContract?.settlements || []).map((x) => ({ key: `settlement-${x.id}`, type: x.kind === "used" ? "Old balance vacation" : "Reimbursement", from: x.startDate || x.recordedAt, to: x.endDate, days: `-${x.days}`, status: x.kind === "used" ? "Used" : "Reimbursed", tone: "neutral", note: x.by })),
  ].sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")));

  return (
    <div className="stack">
      <button className="btn btn-ghost btn-sm profile-back" onClick={onBack}><ChevronRight size={15} style={{ transform: "rotate(180deg)" }} /> Employees</button>
      <div className="profile-hero">
        <span className="profile-ava">{initials(c.name)}</span>
        <div className="profile-id">
          <div className="profile-name">{c.name}</div>
          <div className="profile-sub">{c.position} · {c.code} · {(meta.countries[c.country] || {}).flag || ""} {c.city}</div>
          <div className="profile-tags"><PhaseTag phase={c.phase} /><Badge tone="neutral">{c.warehouse || "no warehouse"}</Badge>{c.salary ? <Badge tone="neutral">AED {money(c.salary)}/mo</Badge> : null}</div>
        </div>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "details" && (
        <section className="panel profile-panel">
          <div className="prof-edit">
            <Field label="Position"><select style={{ width: "100%" }} disabled={!canEdit} value={editCore.position} onChange={(e) => setEditCore({ ...editCore, position: e.target.value })}>{meta.positions.map((pn) => <option key={pn}>{pn}</option>)}</select></Field>
            <Field label="Warehouse (optional)"><select style={{ width: "100%" }} disabled={!canEdit} value={editCore.warehouse} onChange={(e) => setEditCore({ ...editCore, warehouse: e.target.value })}><option value="">None (e.g. mover)</option>{meta.warehouses.filter((w) => w.city === c.city).map((w) => <option key={w.name}>{w.name}</option>)}</select></Field>
            <Field label="Start date"><input type="date" style={{ width: "100%" }} disabled={!canEdit} value={editCore.startDate || ""} onChange={(e) => setEditCore({ ...editCore, startDate: e.target.value })} /></Field>
            <Field label="Contact email"><input type="email" style={{ width: "100%" }} disabled={!canEdit} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@example.com" /></Field>
            <Field label="WhatsApp number"><input style={{ width: "100%" }} disabled={!canEdit} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+9715XXXXXXXX" /></Field>
            <Field label="T-shirt size"><input style={{ width: "100%" }} disabled={!canEdit} value={sizes.tshirtSize} onChange={(e) => setSizes({ ...sizes, tshirtSize: e.target.value })} placeholder="e.g. M, L" /></Field>
            <Field label="Pants size"><input style={{ width: "100%" }} disabled={!canEdit} value={sizes.pantsSize} onChange={(e) => setSizes({ ...sizes, pantsSize: e.target.value })} placeholder="e.g. 32" /></Field>
            <Field label="Shoe size"><input style={{ width: "100%" }} disabled={!canEdit} value={sizes.shoeSize} onChange={(e) => setSizes({ ...sizes, shoeSize: e.target.value })} placeholder="e.g. 42" /></Field>
            <Field label="Base salary (AED/month)"><input className="num-input" style={{ width: "100%" }} disabled={!canEdit} value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} /></Field>
            <Field label="Contract start"><input type="date" disabled={!canEdit} value={p.contractStart || ""} onChange={(e) => set("contractStart", e.target.value)} /></Field>
            <Field label="Contract expiry"><input type="date" disabled={!canEdit} value={p.contractExpiry || ""} onChange={(e) => set("contractExpiry", e.target.value)} /></Field>
            <Field label="Insurance expiry"><input type="date" disabled={!canEdit} value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} /></Field>
          </div>
          <section className="panel profile-panel" style={{ marginTop: 12 }}>
            <div className="panel-h"><h3>Contracts</h3>{canEdit && <button className="btn btn-sm btn-primary" onClick={() => setNewContractForm({ startDate: "", endDate: "" })}><Plus size={14} /> Start new contract</button>}</div>
            <p className="setup-hint">Starting a new contract saves the previous vacation balance. Select a contract in Vacations to review its history and flight ticket.</p>
            <div className="doc-list">
              {(data.contracts || []).map((ct) => (
                <div className="doc-row" key={ct.id} style={{ alignItems: "flex-start" }}>
                  <FileText size={15} className="muted" />
                  <div className="doc-main">
                    <div className="doc-label">{ct.startDate || "?"} → {ct.endDate || "ongoing"} {ct.isCurrent ? <Badge tone="success">Current</Badge> : <Badge tone="neutral">Closed</Badge>}</div>
                    {!ct.isCurrent && ct.unused != null && (
                      <div className="doc-sub" style={{ marginTop: 3 }}>
                        Unused leave: {ct.unused} · used {ct.used} · reimbursed {ct.reimbursed} · <strong>{ct.remaining} remaining</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(!data.contracts || data.contracts.length === 0) && <Empty>No contract on record.</Empty>}
            </div>
          </section>
          <div className="prof-edit" style={{ display: "none" }}>
          </div>
          <div className="prof-grid" style={{ marginTop: 12 }}>
            <div className="ro"><span className="ro-k">Location</span><span className="ro-v">{c.city}, {c.country}</span></div>
            <div className="ro"><span className="ro-k">Phase / stage</span><span className="ro-v">{labelPhase(c.phase)} · {c.stage}</span></div>
          </div>
          {canEdit && <div className="prof-actions"><button className="btn btn-primary" onClick={save}>Save details</button></div>}
          {canEdit && <PortalAccess employeeId={employeeId} core={c} notify={notify} onSaved={load} />}
        </section>
      )}

      {tab === "documents" && (
        <section className="panel profile-panel"><DocumentsPanel employeeId={employeeId} labels={docLabels} /></section>
      )}

      {tab === "uniform" && (
        <section className="panel profile-panel"><ProcurementPanel employeeId={employeeId} role={role} notify={notify} /></section>
      )}

      {tab === "vacations" && (
        <section className="panel profile-panel">
          <label className="field" style={{ marginBottom: 16 }}><span>Contract period</span>
            <select value={viewedContract?.id || ""} onChange={(e) => setViewContractId(Number(e.target.value))}>
              {data.contracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.startDate} → {ct.endDate || "ongoing"} ({ct.isCurrent ? "current" : "previous"})</option>)}
            </select>
          </label>
          {viewedContract && <div className="doc-row" style={{ marginBottom: 18, flexWrap: "wrap" }}>
            <FileText size={17} className="muted" />
            <div className="doc-main"><div className="doc-label">Flight ticket · {viewedContract.ticketStatus === "taken" ? "Taken" : "Available"}</div><div className="doc-sub">For {viewedContract.startDate} → {viewedContract.endDate || "ongoing"}. Uploaded tickets are also saved in Documents.</div></div>
            {viewedContract.hasTicket && <button className="btn btn-sm btn-ghost" onClick={() => openTicket(viewedContract.id)}>Open ticket</button>}
            {canEdit && <button className="btn btn-sm btn-ghost" onClick={() => setTicket(viewedContract.id, viewedContract.ticketStatus === "taken" ? "available" : "taken")}>Mark {viewedContract.ticketStatus === "taken" ? "available" : "taken"}</button>}
            {canEdit && <label className="btn btn-sm btn-ghost" style={{ cursor: "pointer" }}>Attach ticket<input type="file" style={{ display: "none" }} accept="image/*,application/pdf" onChange={(e) => { const file = e.target.files[0]; if (file) uploadTicket(viewedContract.id, file); e.target.value = ""; }} /></label>}
          </div>}
          {viewingCurrent ? <div className="stat-row" style={{ marginBottom: 18, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat label="Entitlement" value={`${ls.entitlement}d`} note="annual leave" accent />
            <Stat label="Added" value={`${ls.bonusDays}d`} note="compensation days" />
            <Stat label="Taken" value={`${ls.taken}d`} note="used this contract" />
            <Stat label="Planned" value={`${ls.planned}d`} note="booked ahead" />
            <Stat label="Remaining" value={`${ls.remaining}d`} note="still available" danger={ls.remaining <= 3} />
          </div> : viewedContract && <div className="stat-row" style={{ marginBottom: 18 }}>
            <Stat label="Entitlement" value={`${viewedContract.entitlement ?? 0}d`} note="at closure" accent />
            <Stat label="Unused at closure" value={`${viewedContract.unused ?? 0}d`} />
            <Stat label="Given / reimbursed" value={`${viewedContract.used + viewedContract.reimbursed}d`} />
            <Stat label="Remaining" value={`${viewedContract.remaining ?? 0}d`} />
          </div>}
          {!viewingCurrent && canEdit && viewedContract?.remaining > 0 && <div className="row-actions" style={{ marginBottom: 16 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setSettlement({ id: viewedContract.id, kind: "used", days: "", remaining: viewedContract.remaining })}>Give vacation from old balance</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSettlement({ id: viewedContract.id, kind: "reimburse", days: "", remaining: viewedContract.remaining })}>Reimburse old balance</button>
          </div>}
          {viewingCurrent && canEdit && (
            <div className="doc-upload" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 16, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" title="Day compensated" value={comp.date} onChange={(e) => setComp({ ...comp, date: e.target.value })} />
              <input className="num-input" style={{ width: 70 }} value={comp.days} onChange={(e) => setComp({ ...comp, days: e.target.value })} title="Days" />
              <input placeholder="Note (e.g. worked Sunday)" value={comp.note} onChange={(e) => setComp({ ...comp, note: e.target.value })} style={{ minWidth: 220 }} />
              <button className="btn btn-sm btn-primary" onClick={addComp}><Plus size={14} /> Add compensation day</button>
            </div>
          )}
          {viewingCurrent && canEdit && (
            <div className="doc-upload" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 16, marginBottom: 14 }}>
              <input type="date" title="Start" value={leave.startDate} onChange={(e) => setLeave({ ...leave, startDate: e.target.value })} />
              <input type="date" title="End" value={leave.endDate} onChange={(e) => setLeave({ ...leave, endDate: e.target.value })} />
              <span className="muted sm" style={{ alignSelf: "center" }}>{leaveDays > 0 ? `${leaveDays} day${leaveDays === 1 ? "" : "s"}` : "pick dates"}</span>
              <select value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value })}><option>Annual</option><option>Sick</option><option>Unpaid</option></select>
              <select value={leave.status} onChange={(e) => setLeave({ ...leave, status: e.target.value })}><option>Planned</option><option>Taken</option></select>
              <button className="btn btn-sm btn-primary" disabled={leaveDays <= 0} onClick={addLeave}><Plus size={14} /> Add leave</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>From</th><th>To</th><th className="ta-r">Days</th><th>Status</th>{canEdit && <th className="ta-r">Manage</th>}</tr></thead>
              <tbody>
                {vacationRows.map((row) => (
                  <tr key={row.key} style={{ cursor: "default" }}>
                    <td>{row.type}{row.note && <div className="muted sm">{row.note}</div>}</td>
                    <td className="sm">{row.from || "-"}</td><td className="sm">{row.to || "-"}</td><td className="ta-r mono">{row.days}</td>
                    <td><Badge tone={row.tone}>{row.status}</Badge></td>
                    {canEdit && <td className="ta-r">{row.remove && <IconDelete onClick={row.remove} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {vacationRows.length === 0 && <Empty>No vacation activity for this contract.</Empty>}
          </div>
        </section>
      )}
      {newContractForm && <>
        <div className="scrim" onClick={() => setNewContractForm(null)} />
        <div className="modal" role="dialog" aria-modal="true" aria-label="Start new contract">
          <div className="modal-h"><h3>Start new contract</h3><button className="icon-btn" onClick={() => setNewContractForm(null)}><X size={18} /></button></div>
          <p className="modal-sub">The current vacation balance will be saved with the previous contract. The new contract starts with a fresh balance.</p>
          <Field label="Start date"><input type="date" value={newContractForm.startDate} onChange={(e) => setNewContractForm({ ...newContractForm, startDate: e.target.value })} /></Field>
          <Field label="End date"><input type="date" min={newContractForm.startDate} value={newContractForm.endDate} onChange={(e) => setNewContractForm({ ...newContractForm, endDate: e.target.value })} /></Field>
          <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setNewContractForm(null)}>Cancel</button><button className="btn btn-primary" disabled={!newContractForm.startDate || !newContractForm.endDate || newContractForm.endDate < newContractForm.startDate} onClick={newContract}>Start contract</button></div>
        </div>
      </>}
      {settlement && <>
        <div className="scrim" onClick={() => setSettlement(null)} />
        <div className="modal" role="dialog" aria-modal="true" aria-label="Settle previous vacation balance">
          <div className="modal-h"><h3>{settlement.kind === "used" ? "Give vacation" : "Reimburse"} from previous contract</h3><button className="icon-btn" onClick={() => setSettlement(null)}><X size={18} /></button></div>
          <p className="modal-sub">{settlement.remaining} day(s) available from this contract.</p>
          {settlement.kind === "used" && <>
            <Field label="Vacation start"><input type="date" value={settlement.startDate || ""} onChange={(e) => setSettlement({ ...settlement, startDate: e.target.value })} /></Field>
            <Field label="Vacation end"><input type="date" min={settlement.startDate || undefined} value={settlement.endDate || ""} onChange={(e) => setSettlement({ ...settlement, endDate: e.target.value })} /></Field>
          </>}
          <Field label="Days"><input type="number" min="0.01" max={settlement.remaining} step="any" value={settlement.days} onChange={(e) => setSettlement({ ...settlement, days: e.target.value })} /></Field>
          <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setSettlement(null)}>Cancel</button><button className="btn btn-primary" disabled={!settlement.days || !Number.isFinite(Number(settlement.days)) || Number(settlement.days) <= 0 || Number(settlement.days) > settlement.remaining || (settlement.kind === "used" && (!settlement.startDate || !settlement.endDate || settlement.endDate < settlement.startDate))} onClick={settleContract}>Record days</button></div>
        </div>
      </>}
    </div>
  );
}

/* ===== Expiry tracker: leave & vacation priority ===== */
function priorityTone(p) { return p <= 3 ? "danger" : p <= 8 ? "warning" : "neutral"; }
function contractLeftLabel(d) { return d == null ? "-" : d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`; }
function LeaveTrackerPage({ country, city, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api.get(`/expiry/leaves?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}`).then(setRows).catch((e) => notify(e.message)); }, [country, city]);
  return (
    <div className="stack">
      <p className="blurb">Who should take leave next. Employees whose contract expires soon and who still have unused leave are highest priority, so their days do not go to waste.</p>
      {!rows ? <Empty>Loading</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Position</th><th>Contract expiry</th><th className="ta-c">Contract left</th><th className="ta-c">Entitlement</th><th className="ta-c">Added</th><th className="ta-c">Taken</th><th className="ta-c">Planned</th><th className="ta-c">Remaining</th><th className="ta-c">Priority</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)}>
                  <td><div className="cell-person"><Avatar name={r.name} sm /><div className="cp-name">{r.name}</div></div></td>
                  <td>{r.position}</td>
                  <td className="sm">{r.contractExpiry || "-"}</td>
                  <td className="ta-c"><span className={"days " + (r.contractDaysLeft != null && r.contractDaysLeft <= 90 ? "d-danger" : "d-success")}>{contractLeftLabel(r.contractDaysLeft)}</span></td>
                  <td className="ta-c mono">{r.entitlement}</td><td className="ta-c mono">{r.added}</td><td className="ta-c mono">{r.taken}</td><td className="ta-c mono">{r.planned}</td>
                  <td className="ta-c mono" style={{ fontWeight: 600 }}>{r.remaining}</td>
                  <td className="ta-c"><Badge tone={priorityTone(r.priority)}>{r.priority}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>No employees in the selected city.</Empty>}
        </div>
      )}
    </div>
  );
}

/* ===== Expiry tracker: document-expiry work orders ===== */
function DocExpiryPage({ country, city, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api.get(`/expiry/documents?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}`).then(setRows).catch((e) => notify(e.message)); }, [country, city]);
  return (
    <div className="stack">
      <p className="blurb">Documents expiring soon become work orders here automatically. The notice window per document type is set in Setup. Most urgent first.</p>
      {!rows ? <Empty>Loading</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Document</th><th>Warehouse</th><th>Expiry</th><th className="ta-r">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.employeeId)}>
                  <td><div className="cell-person"><Avatar name={r.employee} sm /><div><div className="cp-name">{r.employee}</div><div className="cp-id">{r.position}</div></div></div></td>
                  <td><Badge tone="neutral">{r.document}</Badge></td>
                  <td className="muted sm">{r.warehouse}</td>
                  <td className="sm">{r.expiry}</td>
                  <td className="ta-r">{r.status === "expired" ? <Badge tone="danger">Expired {Math.abs(r.daysLeft)}d ago</Badge> : <Badge tone="warning">In {r.daysLeft}d</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>Nothing expiring within the notice windows for the selected city.</Empty>}
        </div>
      )}
    </div>
  );
}

/* ===== Staff: employee requests inbox ===== */
function reqDetail(r) {
  if (r.type === "Vacation" || r.type === "Sick leave") return `${r.days}d${r.startDate ? ` · ${r.startDate}${r.endDate ? ` to ${r.endDate}` : ""}` : ""}`;
  if (r.type === "Uniform") return `${r.item || ""}${r.size ? ` · ${r.size}` : ""} · ×${r.quantity || 1}`;
  return "";
}
function reqOutcome(r) {
  if (r.type === "Vacation") return `On approve: records ${r.days || 0} days annual leave (planned) on the profile`;
  if (r.type === "Sick leave") return r.hasReport
    ? `Medical report attached. Approve as excused (not deducted) or as deducted.`
    : `No medical report. On approve: records ${r.days || 0} days sick leave, deducted from balance.`;
  if (r.type === "Uniform") return `On approve: raises a uniform work order (${r.item || "item"} · ×${r.quantity || 1})`;
  return "On approve: no automatic action";
}
function RequestsPage({ country, city, role, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("Pending");
  function load() { const q = filter === "all" ? "" : `&status=${filter}`; api.get(`/requests?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}${q}`).then(setRows).catch((e) => notify(e.message)); }
  useEffect(load, [country, city, filter]);
  async function approve(id, medicalApproved) { try { await api.post(`/requests/${id}/approve`, medicalApproved === undefined ? {} : { medicalApproved }); load(); notify(medicalApproved === false ? "Approved and deducted" : medicalApproved ? "Approved and excused" : "Approved"); } catch (e) { notify(e.message); } }
  async function reject(id) { const note = window.prompt("Reason for rejecting (optional):") ?? ""; try { await api.post(`/requests/${id}/reject`, { note }); load(); notify("Rejected"); } catch (e) { notify(e.message); } }
  async function viewReport(id) {
    try { const res = await fetch(`/api/requests/${id}/report`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank"); else notify("No report"); }
    catch { notify("Could not open report"); }
  }
  const tone = { Pending: "warning", Approved: "success", Rejected: "danger" };
  return (
    <div className="stack">
      <div className="page-head">
        <p className="blurb">Requests submitted by employees from the self-service app. Approving a leave request records the leave; approving a uniform request raises a work order. For sick leave with a medical report, approve as excused (not deducted) or as deducted.</p>
        <div className="filterbar"><span className="fb-label">Status</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="Pending">Pending</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option><option value="all">All</option></select></div>
      </div>
      {!rows ? <Empty>Loading</Empty> : rows.length === 0 ? <Empty>No {filter === "all" ? "" : filter.toLowerCase()} requests in the selected city.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Type</th><th>Details</th><th>Note</th><th>Status</th><th className="ta-r">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.employeeId)}>
                  <td><div className="cell-person"><Avatar name={r.employee} sm /><div><div className="cp-name">{r.employee}</div><div className="cp-id">{r.position}</div></div></div></td>
                  <td><Badge tone="neutral">{r.type}</Badge>{r.hasReport && <button className="report-link" onClick={(e) => { e.stopPropagation(); viewReport(r.id); }}><Paperclip size={12} /> report</button>}</td>
                  <td className="sm">{reqDetail(r)}{r.status === "Pending" && <div className="req-outcome">{reqOutcome(r)}</div>}{r.status === "Approved" && r.type === "Sick leave" && <div className={"sm " + (r.reportApproved ? "excused-tag" : "deducted-tag")}>{r.reportApproved ? "Excused (not deducted)" : "Deducted"}</div>}</td>
                  <td className="muted sm">{r.note || "-"}{r.decisionNote ? <div className="sm" style={{ marginTop: 3 }}>“{r.decisionNote}”</div> : ""}</td>
                  <td><Badge tone={tone[r.status]}>{r.status}</Badge></td>
                  <td className="ta-r"><div className="row-actions">
                    {r.status === "Pending" ? (r.type === "Sick leave" ? <>
                      <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); approve(r.id, true); }} title="Medical report accepted; days not deducted"><Check size={13} /> Excuse</button>
                      <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); approve(r.id, false); }} title="Approve but deduct the days">Deduct</button>
                      <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); reject(r.id); }}><Ban size={13} /> Reject</button>
                    </> : <>
                      <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); approve(r.id); }}><Check size={13} /> Approve</button>
                      <button className="btn btn-sm btn-ghost reject-btn" onClick={(e) => { e.stopPropagation(); reject(r.id); }}><Ban size={13} /> Reject</button>
                    </>) : <span className="muted sm">{r.decidedBy ? `by ${r.decidedBy}` : "decided"}</span>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ===== Profile: portal access (enable employee self-service login) ===== */
function PortalAccess({ employeeId, core, notify, onSaved }) {
  const [email, setEmail] = useState(core.portalEmail || "");
  const [password, setPassword] = useState("");
  async function save() {
    if (!email) { notify("Enter a login email"); return; }
    try { await api.post(`/candidates/${employeeId}/portal`, { email, password: password || undefined }); setPassword(""); notify("Portal access saved"); onSaved && onSaved(); }
    catch (e) { notify(e.message); }
  }
  return (
    <div className="portal-access">
      <div className="pa-head"><h4>Employee portal access</h4>{core.portalEnabled ? <Badge tone="success">enabled</Badge> : <Badge tone="neutral">not set</Badge>}</div>
      <p className="setup-hint">Give this employee a login for the self-service app to see their pay, time off and to make requests.</p>
      <div className="add-grid">
        <label className="field"><span>Login email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>{core.portalEnabled ? "New password (optional)" : "Password"}</span><input value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div className="field" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" onClick={save}>Save access</button></div>
      </div>
    </div>
  );
}
