import { useState } from "react";
import { useAuth } from "../auth.jsx";

const DEMO = [
  ["Admin", "admin@storage.ae"], ["HR", "hr@storage.ae"], ["PRO", "pro@storage.ae"],
  ["Procurement", "procurement@storage.ae"], ["Facility", "facility@storage.ae"],
  ["L&D", "ld@storage.ae"], ["BA", "ba@storage.ae"], ["Accountant", "accountant@storage.ae"],
];

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState("staff");
  const [email, setEmail] = useState("admin@storage.ae");
  const [password, setPassword] = useState("storage123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(m) {
    setMode(m); setErr("");
    if (m === "employee") { setEmail(""); setPassword(""); }
    else { setEmail("admin@storage.ae"); setPassword("storage123"); }
  }
  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await login(email, password, mode); }
    catch (e2) { setErr(e2.message || "Could not sign in"); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><span className="logo-sq" /><span className="logo-word">storage.ae</span></div>
        <h1>{mode === "employee" ? "Employee self-service" : "People operations"}</h1>
        <p className="sub">{mode === "employee" ? "Sign in to see your pay, time off and requests." : "Sign in to your workspace."}</p>

        <div className="login-toggle">
          <button type="button" className={mode === "staff" ? "on" : ""} onClick={() => switchMode("staff")}>Team</button>
          <button type="button" className={mode === "employee" ? "on" : ""} onClick={() => switchMode("employee")}>Employee</button>
        </div>

        {err && <div className="login-err">{err}</div>}

        <form onSubmit={submit}>
          <label className="login-field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
          <label className="login-field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <button className="btn btn-primary login-btn" disabled={busy}>{busy ? "Signing in" : "Sign in"}</button>
        </form>

        {mode === "staff" && (
          <div className="login-hint">
            Demo accounts, password <code>storage123</code>. Tap to fill:
            <div className="login-roles">
              {DEMO.map(([label, mail]) => (
                <button key={mail} type="button" onClick={() => { setEmail(mail); setPassword("storage123"); }}>{label}</button>
              ))}
            </div>
          </div>
        )}
        {mode === "employee" && <div className="login-hint">Your login is set up by HR. If you cannot sign in, ask them to enable your portal access.</div>}
      </div>
    </div>
  );
}
