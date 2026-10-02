import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";

const AuthContext = createContext(null);
const KIND_KEY = "storage_ae_kind";
const getKind = () => localStorage.getItem(KIND_KEY);
const setKind = (k) => (k ? localStorage.setItem(KIND_KEY, k) : localStorage.removeItem(KIND_KEY));

export function AuthProvider({ children }) {
  const [principal, setPrincipal] = useState(null); // { kind:'user', ...user } | { kind:'employee', ...employee }
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    const kind = getKind() || "user";
    const path = kind === "employee" ? "/portal/me" : "/auth/me";
    api.get(path)
      .then((d) => setPrincipal(kind === "employee" ? { kind: "employee", ...d } : { kind: "user", ...d.user }))
      .catch(() => { setToken(null); setKind(null); })
      .finally(() => setReady(true));
  }, []);

  async function login(email, password, mode = "staff") {
    if (mode === "employee") {
      const d = await api.post("/portal/login", { email, password });
      setToken(d.token); setKind("employee");
      const p = { kind: "employee", ...d.employee };
      setPrincipal(p); return p;
    }
    const d = await api.post("/auth/login", { email, password });
    setToken(d.token); setKind("user");
    const p = { kind: "user", ...d.user };
    setPrincipal(p); return p;
  }
  function logout() { setToken(null); setKind(null); setPrincipal(null); }

  return <AuthContext.Provider value={{ principal, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
