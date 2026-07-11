import { LogOut, Menu, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackendApi } from "./api";
import { Alert, IconButton, Loading } from "./components/ui";
import { navItems, routeFromPath, routeMeta, routePath } from "./navigation";
import { ActionsPage } from "./pages/ActionsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TestMiaPage } from "./pages/TestMiaPage";
import type { AdminUser, Product, RouteId } from "./types";
import { errorMessage } from "./utils/format";

const configuredBackendUrl = (import.meta.env.VITE_MIA_BACKEND_URL as string | undefined)?.trim();
const backendUrl = import.meta.env.DEV && configuredBackendUrl ? configuredBackendUrl : window.location.origin;
const TOKEN_KEY = "mia:v1:admin-session";

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [route, setRoute] = useState<RouteId>(() => routeFromPath(window.location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(""); setUser(null); setProduct(null);
  }, []);
  const api = useMemo(() => new BackendApi(backendUrl, token, clearSession), [token, clearSession]);
  const notify = useCallback((message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 4_000);
  }, []);

  useEffect(() => {
    let active = true;
    setBooting(true);
    void api.setupStatus().then((status) => {
      if (!active) return;
      setSetupRequired(status.setupRequired);
      if (status.authenticated && status.user && status.product) { setUser(status.user); setProduct(status.product); }
      else if (token) clearSession();
      setBootError("");
    }).catch((cause) => { if (active) setBootError(errorMessage(cause)); }).finally(() => { if (active) setBooting(false); });
    return () => { active = false; };
  }, [api, token, clearSession]);

  useEffect(() => {
    const pop = () => { setRoute(routeFromPath(window.location.pathname)); setSidebarOpen(false); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    document.title = user ? `${routeMeta(route).label} | Mia Console` : setupRequired ? "Set up Mia" : "Mia Console";
  }, [route, user, setupRequired]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const navigate = useCallback((next: RouteId) => {
    if (route !== next || window.location.pathname !== routePath[next]) window.history.pushState({}, "", routePath[next]);
    setRoute(next); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  const acceptAuth = (response: { token: string; user: AdminUser; product?: Product }, destination: RouteId) => {
    sessionStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token); setUser(response.user); if (response.product) setProduct(response.product); setSetupRequired(false);
    window.history.replaceState({}, "", routePath[destination]); setRoute(destination);
  };
  const login = async (email: string, password: string) => acceptAuth(await api.login(email, password), "overview");
  const setup = async (input: Parameters<BackendApi["setup"]>[0]) => acceptAuth(await api.setup(input), "setup");
  const logout = async () => {
    try { await api.logout(); } finally { clearSession(); window.history.replaceState({}, "", "/"); setRoute("overview"); }
  };

  if (booting) return <div className="boot-screen"><Loading label="Connecting to Mia" /></div>;
  if (!user || !token) return <><LoginPage setupRequired={setupRequired} backendUrl={backendUrl} onLogin={login} onSetup={setup} />{bootError ? <div className="auth-error"><Alert tone="danger">{bootError}</Alert></div> : null}</>;
  const meta = routeMeta(route);
  const pageProps = { api, refreshNonce, notify };

  return (
    <div className="console-shell">
      <aside className="sidebar" data-open={sidebarOpen} aria-label="Mia Console navigation">
        <header className="sidebar-brand"><div className="brand-mark"><span>M</span></div><div><strong>Mia</strong><span>Product Agent</span></div><IconButton label="Close navigation" className="sidebar-close" onClick={() => setSidebarOpen(false)}><X /></IconButton></header>
        <div className="product-lockup"><span>Production product</span><strong>{product?.name ?? "Mia"}</strong><code>{product?.origin ?? ""}</code></div>
        <nav>{navItems.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} data-active={route === item.id} onClick={() => navigate(item.id)}><Icon aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</nav>
        <footer><div className="admin-summary"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div><IconButton label="Sign out" onClick={() => void logout()}><LogOut /></IconButton></footer>
      </aside>
      {sidebarOpen ? <button className="sidebar-backdrop" aria-label="Dismiss navigation overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <main className="main-shell">
        <header className="topbar"><div className="topbar-title"><IconButton label="Open navigation" className="menu-button" onClick={() => setSidebarOpen(true)}><Menu /></IconButton><div><span>{product?.name}</span><h1 tabIndex={-1}>{meta.label}</h1><p>{meta.description}</p></div></div><IconButton label="Refresh page data" onClick={() => setRefreshNonce((value) => value + 1)}><RefreshCw /></IconButton></header>
        <div className="page-content">
          {route === "setup" ? <SetupPage {...pageProps} onNavigate={navigate} /> : null}
          {route === "overview" ? <OverviewPage api={api} refreshNonce={refreshNonce} onNavigate={navigate} /> : null}
          {route === "knowledge" ? <KnowledgePage {...pageProps} /> : null}
          {route === "skills" ? <SkillsPage {...pageProps} /> : null}
          {route === "actions" ? <ActionsPage {...pageProps} /> : null}
          {route === "test" ? <TestMiaPage api={api} refreshNonce={refreshNonce} /> : null}
          {route === "runs" ? <RunsPage api={api} refreshNonce={refreshNonce} /> : null}
          {route === "settings" ? <SettingsPage {...pageProps} user={user} onProductChange={setProduct} /> : null}
        </div>
      </main>
      {toast ? <div className="toast" role="status"><span />{toast}</div> : null}
    </div>
  );
}
