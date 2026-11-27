import { useEffect, useState } from "react";
import { api, useApi, Badge, toast, can, useUser, dt } from "../ui.tsx";

export function Settings() {
  const user = useUser();
  const admin = can(user, "admin");
  const [tab, setTab] = useState(0);
  const tabs = ["Integrações", "Anúncios próprios", "Validade e limites", "Categorias", ...(admin ? ["Usuários"] : [])];
  return <div>
    <div className="tabs" style={{ marginBottom: 12, padding: 0 }}>{tabs.map((t, i) => <button key={t} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t}</button>)}</div>
    {tab === 0 && <Integrations />}
    {tab === 1 && <OwnStores admin={admin} />}
    {tab === 2 && <Limits admin={admin} />}
    {tab === 3 && <Categories admin={admin} />}
    {tab === 4 && admin && <Users />}
  </div>;
}

function Integrations() {
  const { data } = useApi<any[]>("/integrations");
  const { data: fx, reload } = useApi<any[]>("/fx");
  async function test(c: string) { try { const q = await api(`/fx/${c}`, { method: "POST" }); toast(`${c}: R$ ${Number(q.rate).toFixed(4)} (${q.source})`); reload(); } catch (e: any) { toast(e.message, true); } }
  return <div className="col" style={{ gap: 12 }}>
    <div className="note info">Credenciais ficam somente no arquivo <span className="mono">.env</span> do servidor, nunca no navegador. Integração sem credencial aparece como “não configurada” e a etapa correspondente não é executada nem simulada.</div>
    <div className="tablewrap"><table className="t"><thead><tr><th>Serviço</th><th>Finalidade</th><th>Status</th><th>Necessário</th><th>Custo</th><th>Limitações</th></tr></thead>
      <tbody>{(data || []).map((i) => <tr key={i.key}><td><b>{i.name}</b></td><td className="small">{i.purpose}</td><td><Badge s={i.status} /></td><td className="small">{i.needs}</td><td className="small">{i.cost}</td><td className="small">{i.limitations}</td></tr>)}</tbody></table></div>
    <div className="card"><h3>Câmbio — Banco Central (PTAX)</h3><div className="body">
      <div className="row" style={{ marginBottom: 8 }}>{["USD", "EUR", "GBP", "JPY", "CAD"].map((c) => <button key={c} className="btn sm" onClick={() => test(c)}>Consultar {c}</button>)}</div>
      <table className="t"><thead><tr><th>Moeda</th><th className="num">BRL por unidade</th><th>Fonte</th><th>Cotação de</th><th>Consultado em</th></tr></thead>
        <tbody>{(fx || []).map((q) => <tr key={q.id}><td>{q.currency}</td><td className="num">{Number(q.rate).toFixed(4)}</td><td className="small">{q.source}</td><td className="small">{dt(q.quoted_at)}</td><td className="small">{dt(q.fetched_at)}</td></tr>)}</tbody></table>
    </div></div>
  </div>;
}

function useSetting(key: string) {
  const { data, reload } = useApi<any>("/settings");
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (data) setV(data[key]); }, [data]);
  const save = async (val?: any) => { try { await api(`/settings/${key}`, { method: "PUT", body: val ?? v }); toast("Configuração salva"); reload(); } catch (e: any) { toast(e.message, true); } };
  return [v, setV, save] as const;
}

function OwnStores({ admin }: { admin: boolean }) {
  const [v, setV, save] = useSetting("proprios");
  if (!v) return null;
  const F = (k: string, l: string, help: string) => <label className="f"><span>{l}</span><textarea disabled={!admin} value={(v[k] || []).join("\n")} onChange={(e) => setV({ ...v, [k]: e.target.value.split("\n") })} placeholder={help} /></label>;
  return <div className="card"><h3>Identificação dos anúncios da Paulicomp (PR e SP)</h3><div className="body">
    <div className="muted small" style={{ marginBottom: 8 }}>Um por linha. Anúncios que contenham qualquer um destes termos no link, loja ou vendedor são marcados como próprios, exibidos separadamente e excluídos dos indicadores de concorrência.</div>
    <div className="grid2">{F("dominios", "Domínios próprios", "paulicomp.com.br")}{F("urls", "URLs dos e-commerces", "https://loja...")}{F("vendedores", "Nomes de vendedores nos marketplaces", "PAULICOMP SP")}{F("contas_marketplace", "Identificadores de contas", "ID do vendedor ML")}{F("nomes", "Variações do nome da empresa", "Paulicomp")}</div>
    {admin && <button className="btn primary" style={{ marginTop: 10 }} onClick={() => { const clean = Object.fromEntries(Object.entries(v).map(([k, x]: any) => [k, x.map((s: string) => s.trim()).filter(Boolean)])); setV(clean); save(clean); }}>Salvar</button>}
  </div></div>;
}

function Limits({ admin }: { admin: boolean }) {
  const [val, setVal, saveVal] = useSetting("validade");
  const [lim, setLim, saveLim] = useSetting("limites");
  if (!val || !lim) return null;
  const N = (o: any, set: any, k: string, l: string) => <label className="f"><span>{l}</span><input type="number" disabled={!admin} value={o[k] ?? ""} onChange={(e) => set({ ...o, [k]: e.target.value === "" ? null : Number(e.target.value) })} /></label>;
  return <div className="grid2">
    <div className="card"><h3>Validade das pesquisas</h3><div className="body col">
      {N(val, setVal, "comercial_dias", "Pesquisa comercial: atualização sugerida após (dias)")}
      {N(val, setVal, "tecnica_dias", "Dados técnicos validados: revisão após (dias; vazio = reaproveitamento contínuo)")}
      <div className="small muted">Câmbio: atualizado a cada nova pesquisa internacional (cotações reaproveitadas por até 1 hora em pesquisas em massa).</div>
      {admin && <button className="btn primary" onClick={() => saveVal()}>Salvar</button>}
    </div></div>
    <div className="card"><h3>Limites de custo e consumo</h3><div className="body col">
      {N(lim, setLim, "custo_mensal_usd", "Limite mensal (US$)")}{N(lim, setLim, "custo_por_lote_usd", "Limite por lote (US$)")}
      {N(lim, setLim, "max_buscas_web_por_sku", "Máximo de buscas web por SKU")}{N(lim, setLim, "max_anuncios_por_pesquisa", "Máximo de anúncios por pesquisa")}
      {N(lim, setLim, "concorrencia_worker", "Pesquisas simultâneas no worker")}
      {admin && <button className="btn primary" onClick={() => saveLim()}>Salvar</button>}
    </div></div>
  </div>;
}

function Categories({ admin }: { admin: boolean }) {
  const { data, reload } = useApi<any>("/categories");
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [newCat, setNewCat] = useState("");
  if (!data) return null;
  async function save(c: any) { try { await api(`/categories/${c.id}`, { method: "PUT", body: { fields: edit[c.id].split("\n") } }); toast("Campos atualizados"); setEdit((e) => { const x = { ...e }; delete x[c.id]; return x; }); reload(); } catch (e: any) { toast(e.message, true); } }
  async function alias(raw: string, category_id: number) { await api("/category-aliases", { method: "PUT", body: { raw, category_id } }); reload(); }
  return <div className="grid2">
    <div className="card"><h3>Campos técnicos por categoria</h3><div className="body">
      {data.categories.map((c: any) => <div key={c.id} className="section"><div className="row"><b>{c.name}</b>{admin && edit[c.id] === undefined && <button className="btn sm right" onClick={() => setEdit({ ...edit, [c.id]: c.fields.map((f: any) => f.label).join("\n") })}>Editar campos</button>}</div>
        {edit[c.id] !== undefined ? <><textarea value={edit[c.id]} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} style={{ minHeight: 120 }} /><button className="btn sm primary" onClick={() => save(c)}>Salvar</button></>
          : <div className="small muted">{c.fields.map((f: any) => f.label).join(" · ") || "Sem campos"}</div>}</div>)}
      {admin && <div className="row"><input placeholder="Nova categoria" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn" onClick={async () => { await api("/categories", { body: { name: newCat } }); setNewCat(""); reload(); }}>Adicionar</button></div>}
    </div></div>
    <div className="card"><h3>Commodity Lenovo → categoria</h3><div className="body">
      <div className="small muted" style={{ marginBottom: 8 }}>Usado só como categoria inicial (marcada com * na lista) até a validação. O texto original da Lenovo é sempre preservado.</div>
      <table className="t"><tbody>{data.aliases.map((a: any) => <tr key={a.raw}><td className="mono small">{a.raw}</td><td>{admin ? <select value={a.category_id} onChange={(e) => alias(a.raw, Number(e.target.value))}>{data.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : data.categories.find((c: any) => c.id === a.category_id)?.name}</td></tr>)}</tbody></table>
    </div></div>
  </div>;
}

const ROLES: [string, string][] = [["admin", "Administrador"], ["pesquisador", "Pesquisador"], ["validador", "Validador"], ["consulta", "Consulta"]];
function Users() {
  const { data, reload } = useApi<any[]>("/users");
  const [n, setN] = useState<any>({ roles: ["pesquisador"] });
  async function create() { try { await api("/users", { body: n }); toast("Usuário criado"); setN({ roles: ["pesquisador"] }); reload(); } catch (e: any) { toast(e.message, true); } }
  async function patch(u: any, body: any) { try { await api(`/users/${u.id}`, { method: "PATCH", body }); reload(); } catch (e: any) { toast(e.message, true); } }
  const toggleRole = (roles: string[], r: string) => (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  return <div className="col" style={{ gap: 12 }}>
    <div className="tablewrap"><table className="t"><thead><tr><th>Nome</th><th>E-mail</th>{ROLES.map(([, l]) => <th key={l}>{l}</th>)}<th>Ativo</th><th></th></tr></thead>
      <tbody>{(data || []).map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td>{ROLES.map(([r]) => <td key={r}><input type="checkbox" checked={u.roles.includes(r)} onChange={() => patch(u, { roles: toggleRole(u.roles, r) })} /></td>)}
        <td><input type="checkbox" checked={u.active} onChange={() => patch(u, { active: !u.active })} /></td>
        <td><button className="btn sm" onClick={() => { const p = prompt(`Nova senha para ${u.name} (mín. 8 caracteres):`); if (p) patch(u, { password: p }); }}>Redefinir senha</button></td></tr>)}</tbody></table></div>
    <div className="card"><h3>Novo usuário</h3><div className="body row wrap">
      <input placeholder="Nome" value={n.name || ""} onChange={(e) => setN({ ...n, name: e.target.value })} />
      <input type="email" placeholder="E-mail" value={n.email || ""} onChange={(e) => setN({ ...n, email: e.target.value })} />
      <input type="password" placeholder="Senha inicial (mín. 8)" value={n.password || ""} onChange={(e) => setN({ ...n, password: e.target.value })} />
      {ROLES.map(([r, l]) => <label key={r} className="row small"><input type="checkbox" checked={n.roles.includes(r)} onChange={() => setN({ ...n, roles: toggleRole(n.roles, r) })} />{l}</label>)}
      <button className="btn primary" onClick={create}>Criar</button>
    </div></div>
  </div>;
}
