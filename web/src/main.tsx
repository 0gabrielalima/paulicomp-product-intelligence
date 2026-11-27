import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { api, UserCtx, Toaster, type User } from "./ui.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Lots } from "./pages/Lots.tsx";
import { LotView } from "./pages/LotView.tsx";
import { Products } from "./pages/Products.tsx";
import { Research } from "./pages/Research.tsx";
import { Validations } from "./pages/Validations.tsx";
import { History } from "./pages/History.tsx";
import { Settings } from "./pages/Settings.tsx";
import { ProductPanel } from "./pages/ProductPanel.tsx";

function useHash() {
  const [h, setH] = useState(location.hash || "#/dashboard");
  useEffect(() => { const f = () => setH(location.hash || "#/dashboard"); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return h;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState("");
  return <div className="login"><form onSubmit={async (e) => { e.preventDefault(); try { onLogin(await api("/auth/login", { body: { email, password: pw } })); } catch (x: any) { setErr(x.message); } }}>
    <h1>PAULICOMP</h1><p>Product Intelligence</p>
    <label className="f"><span>E-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
    <label className="f"><span>Senha</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
    {err && <div className="err">{err}</div>}
    <button className="btn primary" type="submit">Entrar</button>
  </form></div>;
}

function GlobalSearch({ onOpen }: { onOpen: (productId: number, itemId?: number) => void }) {
  const [q, setQ] = useState(""), [res, setRes] = useState<any[]>([]), [open, setOpen] = useState(false);
  const t = useRef<any>(null);
  useEffect(() => {
    clearTimeout(t.current);
    if (q.trim().length < 2) { setRes([]); return; }
    t.current = setTimeout(() => api(`/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => {}), 220);
  }, [q]);
  return <div className="gsearch">
    <input type="search" placeholder="Buscar SKU, Part Number, nome comercial ou nomenclatura…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
    {open && res.length > 0 && <div className="res">{res.map((r) => <a key={r.product_id} href="#" onMouseDown={(e) => { e.preventDefault(); onOpen(r.product_id, r.item_id); setOpen(false); }}>
      <div className="row"><b className="mono">{r.sku}</b>{r.lot_code && <span className="faint small">lote {r.lot_code}</span>}{r.matched_code && <span className="b blue">{r.matched_code}</span>}</div>
      <div className="small muted trunc">{r.name || r.original_description}</div>
    </a>)}</div>}
  </div>;
}

const NAV = [
  ["#/dashboard", "Dashboard", "▦"], ["#/lotes", "Lotes", "▤"], ["#/produtos", "Base de produtos", "◫"], ["#/pesquisas", "Central de pesquisas", "⟳"],
  ["#/validacoes", "Central de validações", "✓"], ["#/historico", "Histórico", "☰"], ["#/config", "Configurações", "⚙"],
];

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [global, setGlobal] = useState<{ productId: number; itemId?: number } | null>(null);
  const hash = useHash();
  useEffect(() => { api<User>("/me").then(setUser).catch(() => setUser(null)); const f = () => setUser(null); window.addEventListener("ppi:logout", f); return () => window.removeEventListener("ppi:logout", f); }, []);
  if (user === undefined) return null;
  if (!user) return <><Login onLogin={setUser} /><Toaster /></>;
  const [, route, id] = hash.split("/");
  let page, title;
  switch (route) {
    case "lotes": page = id ? <LotView key={id} lotId={Number(id)} /> : <Lots />; title = id ? "Lote" : "Lotes"; break;
    case "produtos": page = <Products onOpen={(p, i) => setGlobal({ productId: p, itemId: i })} />; title = "Base de produtos"; break;
    case "pesquisas": page = <Research onOpen={(p) => setGlobal({ productId: p })} />; title = "Central de pesquisas"; break;
    case "validacoes": page = <Validations onOpen={(p, i) => setGlobal({ productId: p, itemId: i })} />; title = "Central de validações"; break;
    case "historico": page = <History />; title = "Histórico"; break;
    case "config": page = <Settings />; title = "Configurações"; break;
    default: page = <Dashboard />; title = "Dashboard";
  }
  return <UserCtx.Provider value={user}>
    <div className="app">
      <aside className="side">
        <div className="logo"><b>PAULICOMP</b><span>PRODUCT INTELLIGENCE</span></div>
        <nav>{NAV.map(([h, l, i]) => <a key={h} href={h} className={hash.startsWith(h) ? "on" : ""}><span>{i}</span>{l}</a>)}</nav>
        <div className="me">{user.name}<div className="faint small">{user.roles.join(", ")}</div>
          <button onClick={async () => { await api("/auth/logout", { method: "POST" }); setUser(null); }}>Sair</button></div>
      </aside>
      <div className="main">
        <div className="topbar"><h1>{title}</h1><GlobalSearch onOpen={(p, i) => setGlobal({ productId: p, itemId: i })} /></div>
        <div className="content">{page}</div>
      </div>
    </div>
    {global && <ProductPanel productId={global.productId} itemId={global.itemId} onClose={() => setGlobal(null)} />}
    <Toaster />
  </UserCtx.Provider>;
}

createRoot(document.getElementById("root")!).render(<App />);
