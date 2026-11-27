import { Fragment, useEffect, useMemo, useState } from "react";
import { api, useApi, money, num, dt, Badge, Modal, toast, copy, can, useUser, Ext, lab, LABELS, Select, fmtCur, statusLabel } from "../ui.tsx";

type Nav = { index: number; total: number; prev?: () => void; next?: () => void };
const TABS = ["Dados originais", "Pesquisa técnica", "Compatibilidades", "Mercado nacional", "Mercado internacional", "Concorrência indireta", "Análise da IA", "Validação humana", "Histórico"];

export function ProductPanel({ productId, itemId, onClose, onChanged, nav }: { productId: number; itemId?: number; onClose: () => void; onChanged?: () => void; nav?: Nav }) {
  const user = useUser();
  const { data: d, error, reload } = useApi<any>(`/products/${productId}${itemId ? `?item=${itemId}` : ""}`);
  const [tab, setTab] = useState(() => Number(sessionStorage.getItem("ppi:tab") || 0));
  const [full, setFull] = useState(false);
  useEffect(() => { try { sessionStorage.setItem("ppi:tab", String(tab)); } catch { /* */ } }, [tab]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,select,textarea")) return;
      if (e.key === "Escape") onClose();
      if (e.altKey && e.key === "ArrowRight" && nav?.next) nav.next();
      if (e.altKey && e.key === "ArrowLeft" && nav?.prev) nav.prev();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [nav, onClose]);
  const changed = () => { reload(); onChanged?.(); };

  async function research(kind: string) {
    try {
      const r = await api("/research/start", { body: { item_ids: [d.item?.id].filter(Boolean), kind } });
      toast(r.created ? "Pesquisa enviada para a fila" : "Já existe pesquisa ativa para este produto", !r.created); changed();
    } catch (e: any) { toast(e.message, true); }
  }

  if (error) return <Shell onClose={onClose} full={full}><div className="pb"><div className="note">{error}</div></div></Shell>;
  if (!d) return <Shell onClose={onClose} full={full}><div className="pb empty">Carregando…</div></Shell>;
  const it = d.item || {};
  const ls = d.listings || [];
  const counts = [d.rawRows.length, d.codes.length + d.facts.length, d.compat.length, ls.filter((l: any) => l.market === "nacional" && l.competition === "direta").length, ls.filter((l: any) => l.market === "internacional" && l.competition === "direta").length, ls.filter((l: any) => l.competition === "indireta").length, d.aiAll.length, d.techVals.length + d.comVals.length, d.history.length];

  return <Shell onClose={onClose} full={full}>
    <div className="ph">
      {d.images[0] ? <img src={d.images[0].url} alt="" /> : <div className="imgph">sem imagem oficial</div>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap"><span className="mono b gray">{d.product.sku}</span>{it.fru && <span className="mono b blue" title="Número da peça de serviço (oficial Lenovo)">FRU {it.fru}</span>}<span className="small muted">{it.category || "Sem categoria"}</span>{it.lot_code && <span className="small faint">· lote {it.lot_code} · {num(it.quantity)} unid.</span>}</div>
        <h2 className="trunc" style={{ maxWidth: "100%" }}>{it.name || <span className="muted">Nome comercial ainda não identificado</span>}</h2>
        <div className="small muted trunc">Nomenclatura Lenovo: <span className="mono">{it.original_description}</span></div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          <Badge s={it.research_status} prefix="Pesquisa: " /><Badge s={it.tech_status} prefix="Técnica: " /><Badge s={it.approved_price != null ? "aprovada" : it.com_status} prefix="Comercial: " />
          <Badge s={it.conf_tech} prefix="Conf. técnica: " /><Badge s={it.conf_compat} prefix="Conf. compat.: " /><Badge s={it.conf_com} prefix="Conf. comercial: " />
        </div>
      </div>
      <div className="col" style={{ alignItems: "flex-end" }}>
        <div className="row">
          {nav && <><button className="btn sm" disabled={!nav.prev} onClick={nav.prev} title="Produto anterior (Alt+←)">‹ Anterior</button><span className="small faint">{nav.index + 1}/{nav.total}</span><button className="btn sm" disabled={!nav.next} onClick={nav.next} title="Próximo produto (Alt+→)">Próximo ›</button></>}
          <button className="iconbtn" title={full ? "Painel lateral" : "Tela cheia"} onClick={() => setFull(!full)}>{full ? "⇲" : "⛶"}</button>
          <button className="iconbtn" onClick={onClose} title="Fechar (Esc)">✕</button>
        </div>
        {can(user, "pesquisador") && <div className="row">
          <button className="btn sm" onClick={() => research("completa")}>Pesquisar novamente</button>
          <button className="btn sm" onClick={() => research("precos")}>Só preços</button>
          <button className="btn sm" onClick={() => research("tecnica")}>Só técnicos</button>
          <button className="btn sm" onClick={() => research("ia")}>Nova análise IA</button>
        </div>}
      </div>
    </div>
    <div className="tabs">{TABS.map((t, i) => <button key={t} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{i + 1}. {t}<span className="c">{counts[i]}</span></button>)}</div>
    <div className="pb">
      {tab === 0 && <OriginalTab d={d} />}
      {tab === 1 && <TechTab d={d} changed={changed} />}
      {tab === 2 && <CompatTab d={d} changed={changed} />}
      {tab === 3 && <MarketTab d={d} market="nacional" competition="direta" changed={changed} />}
      {tab === 4 && <MarketTab d={d} market="internacional" competition="direta" changed={changed} />}
      {tab === 5 && <MarketTab d={d} competition="indireta" changed={changed} />}
      {tab === 6 && <AiTab d={d} />}
      {tab === 7 && <ValidationTab d={d} changed={changed} />}
      {tab === 8 && <HistoryTab d={d} />}
    </div>
  </Shell>;
}

function Shell({ children, onClose, full }: { children: React.ReactNode; onClose: () => void; full: boolean }) {
  return <><div className="panel-bg" onClick={onClose} /><div className={`panel ${full ? "full" : ""}`}>{children}</div></>;
}

function Src({ r }: { r: any }) {
  const when = r.fetched_at ? ` · ${dt(r.fetched_at)}` : "";
  if (r.source_url) return <span className="small"><Ext href={r.source_url}>{r.source_title || r.source_type || "fonte"} ↗</Ext><span className="faint">{when}</span>{r.source_reference && <div className="faint">{r.source_reference}</div>}</span>;
  return <span className="small faint">{r.source_reference || r.source_type || "—"}{when}</span>;
}

// ---------- 1. Dados originais (somente leitura) ----------
function OriginalTab({ d }: { d: any }) {
  return <div>
    <div className="note gray" style={{ marginBottom: 12 }}>Dados exatamente como recebidos da Lenovo. Somente leitura — nenhuma pesquisa ou validação altera esta camada.</div>
    {d.rawRows.map((r: any) => <div className="card section" key={r.id}><h3>Lote {r.lot_code} · linha {r.row_number} da planilha</h3><div className="body kv">
      {(r.headers?.length ? [...r.headers, ...Object.keys(r.raw).filter((k: string) => !r.headers.includes(k))] : Object.keys(r.raw)).filter((k: string) => k in r.raw).map((k: string) => <Fragment key={k}><div>{k}</div><div className="mono">{String(r.raw[k])}</div></Fragment>)}
      {r.issues?.length > 0 && <><div>Observações da importação</div><div>{r.issues.join("; ")}</div></>}
    </div></div>)}
    {d.items.length > 1 && <div className="card"><h3>Presença em lotes</h3><div className="body">{d.items.map((i: any) => <div key={i.id}>Lote {i.lot_code}: {num(i.quantity)} unidades · preço aprovado {money(i.approved_price)}</div>)}</div></div>}
  </div>;
}

// ---------- 2. Pesquisa tecnica ----------
function TechTab({ d, changed }: { d: any; changed: () => void }) {
  const user = useUser();
  const [form, setForm] = useState<"" | "lenovo" | "fonte">("");
  const byField = useMemo(() => { const m: Record<string, any[]> = {}; for (const f of d.facts) (m[f.field] ||= []).push(f); return m; }, [d.facts]);
  const divergences = Object.entries(byField).filter(([, xs]) => new Set(xs.map((x) => x.value.trim().toLowerCase())).size > 1);
  const lenovo = d.sources.filter((s: any) => s.source_type === "lenovo_parts_lookup");
  return <div>
    {!lenovo.length && <div className="note" style={{ marginBottom: 12 }}>Consulta oficial Lenovo ainda não registrada para este SKU. Use “Consulta Lenovo” na lista do lote (blocos de 100) ou registre aqui o resultado do Parts Lookup.</div>}
    {can(user, "pesquisador", "validador") && <div className="row" style={{ marginBottom: 12 }}>
      <button className="btn" onClick={() => setForm("lenovo")}>Registrar consulta Lenovo</button>
      <button className="btn" onClick={() => setForm("fonte")}>Adicionar fonte / especificação</button>
      <Ext href="https://support.lenovo.com/br/pt/parts-lookup">Abrir Parts Lookup ↗</Ext>
      <Ext href={`https://psref.lenovo.com/`}>PSREF ↗</Ext>
    </div>}
    {divergences.length > 0 && <div className="note" style={{ marginBottom: 12 }}><b>Divergências entre fontes:</b> {divergences.map(([f]) => f).join(", ")}</div>}
    <div className="section"><h4>Códigos</h4>
      {d.codes.length ? <table className="t"><thead><tr><th>Código</th><th>Tipo</th><th>Confirmação</th><th>Fonte</th><th>Obs.</th></tr></thead><tbody>
        {d.codes.map((c: any) => <tr key={c.id}><td className="mono">{c.code}</td><td>{c.code_type}</td><td><Badge s={c.confirmation === "oficial" ? "alta" : c.confirmation === "hipotese" ? "baixa" : "media"} prefix="" title={lab("confirmation", c.confirmation)} /> {lab("confirmation", c.confirmation)}</td><td><Src r={c} /></td><td className="small">{c.notes}</td></tr>)}
      </tbody></table> : <div className="faint">Nenhum código coletado.</div>}
    </div>
    <div className="section"><h4>Especificações coletadas</h4>
      {d.facts.length ? <table className="t"><thead><tr><th>Campo</th><th>Valor</th><th>Confirmação</th><th>Fonte</th></tr></thead><tbody>
        {d.facts.map((f: any) => <tr key={f.id} className={divergences.some(([k]) => k === f.field) ? "changed" : ""}><td>{f.field}</td><td>{f.value}</td><td>{lab("confirmation", f.confirmation)}</td><td><Src r={f} /></td></tr>)}
      </tbody></table> : <div className="faint">Nenhuma especificação coletada. Nada é preenchido sem fonte.</div>}
    </div>
    {d.images.length > 0 && <div className="section"><h4>Fotografias oficiais</h4><div className="row wrap">{d.images.map((i: any) => <a key={i.id} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} style={{ width: 110, height: 110, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 4 }} /></a>)}</div></div>}
    <div className="section"><h4>Fontes consultadas</h4>
      {d.sources.length ? <table className="t"><thead><tr><th>Tipo</th><th>Fonte</th><th>Data</th></tr></thead><tbody>{d.sources.map((s: any) => <tr key={s.id}><td>{s.source_type}</td><td>{s.url ? <Ext href={s.url}>{s.title || s.url}</Ext> : s.title}{s.reference && <div className="faint small">{s.reference}</div>}</td><td className="small">{dt(s.fetched_at)}</td></tr>)}</tbody></table> : <div className="faint">Nenhuma fonte registrada.</div>}
    </div>
    {form === "lenovo" && <LenovoForm d={d} onClose={() => setForm("")} done={changed} />}
    {form === "fonte" && <SourceForm d={d} onClose={() => setForm("")} done={changed} />}
  </div>;
}

function LenovoForm({ d, onClose, done }: { d: any; onClose: () => void; done: () => void }) {
  const [f, setF] = useState<any>({ consulted_at: "" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  async function save() { try { const r = await api(`/products/${d.product.id}/lenovo`, { body: f }); toast(`Consulta registrada (${r.items} informações oficiais)`); onClose(); done(); } catch (e: any) { toast(e.message, true); } }
  return <Modal title={`Registrar resultado do Lenovo Parts Lookup — ${d.product.sku}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Registrar como fonte oficial</button></>}>
    <div className="note info" style={{ marginBottom: 10 }}>Copie do site exatamente o que ele exibe. Os dados serão gravados como “oficial Lenovo Parts Lookup” com data/hora e seu nome.</div>
    <div className="grid2">
      <label className="f"><span>Nº da peça de serviço (FRU)</span><input value={f.fru || ""} onChange={s("fru")} /></label>
      <label className="f"><span>Título / nome oficial</span><input value={f.official_name || ""} onChange={s("official_name")} /></label>
      <label className="f"><span>Mercadoria (commodity)</span><input value={f.commodity || ""} onChange={s("commodity")} /></label>
      <label className="f"><span>Data/hora da consulta</span><input type="datetime-local" value={f.consulted_at} onChange={s("consulted_at")} /></label>
    </div>
    <label className="f"><span>Compatibilidade — machine types (um por linha ou separados por ;)</span><textarea value={f.machine_types || ""} onChange={s("machine_types")} /></label>
    <label className="f"><span>Substitutos / equivalentes (códigos)</span><textarea value={f.substitutes || ""} onChange={s("substitutes")} /></label>
    <label className="f"><span>Especificações (“Campo: valor”, uma por linha)</span><textarea value={f.specs || ""} onChange={s("specs")} /></label>
    <label className="f"><span>Links das fotos oficiais</span><textarea value={f.images || ""} onChange={s("images")} /></label>
    <label className="row small"><input type="checkbox" checked={!!f.not_found} onChange={s("not_found")} /> O site não encontrou correspondência para este SKU</label>
  </Modal>;
}

function SourceForm({ d, onClose, done }: { d: any; onClose: () => void; done: () => void }) {
  const [f, setF] = useState<any>({ source_type: "fabricante", confirmation: "fonte_complementar", facts: "" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save() {
    const facts = String(f.facts).split("\n").map((l) => l.split(/[:\t]/)).filter((x) => x.length >= 2).map(([a, ...b]) => ({ field: a.trim(), value: b.join(":").trim() }));
    try { await api(`/products/${d.product.id}/sources`, { body: { ...f, facts } }); toast("Fonte adicionada"); onClose(); done(); } catch (e: any) { toast(e.message, true); }
  }
  return <Modal title="Adicionar fonte e especificações" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Salvar</button></>}>
    <div className="grid2">
      <label className="f"><span>Tipo de fonte</span><select value={f.source_type} onChange={s("source_type")}><option value="fabricante">Documentação do fabricante</option><option value="psref">Lenovo PSREF</option><option value="lenovo_parts_lookup">Lenovo Parts Lookup</option><option value="marketplace">Anúncio / marketplace</option><option value="manual">Outra</option></select></label>
      <label className="f"><span>Confirmação</span><Select group="confirmation" value={f.confirmation} onChange={(v) => setF({ ...f, confirmation: v })} /></label>
      <label className="f"><span>Link</span><input value={f.url || ""} onChange={s("url")} placeholder="https://" /></label>
      <label className="f"><span>Título / referência</span><input value={f.title || ""} onChange={s("title")} /></label>
    </div>
    <label className="f"><span>Especificações (“Campo: valor”, uma por linha)</span><textarea value={f.facts} onChange={s("facts")} /></label>
  </Modal>;
}

// ---------- 3. Compatibilidades ----------
function CompatTab({ d, changed }: { d: any; changed: () => void }) {
  const user = useUser();
  const [q, setQ] = useState(""), [conf, setConf] = useState(""), [add, setAdd] = useState(false);
  const rows = d.compat.filter((c: any) => (!conf || c.confirmation === conf) && (!q || [c.brand, c.line, c.family, c.model, c.machine_type, c.machine_code].join(" ").toLowerCase().includes(q.toLowerCase())));
  const text = rows.map((c: any) => [c.brand, c.line, c.family, c.model, c.machine_type, c.machine_code].filter(Boolean).join(" ")).join("\n");
  return <div>
    <div className="note gray" style={{ marginBottom: 10 }}>Compatibilidade é crítica para evitar vendas incorretas. A lista é exibida completa; “confirmada para o SKU” só vem do Parts Lookup. Equipamento vendido com o mesmo componente (PSREF) e compatibilidade genérica são classificações separadas.</div>
    <div className="toolbar">
      <input type="search" placeholder="Filtrar modelos / machine types" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select group="compat" value={conf} onChange={setConf} empty="Todas as classificações" />
      <span className="small muted">{rows.length} de {d.compat.length}</span>
      <button className="btn right" onClick={() => copy(text, `${rows.length} compatibilidades copiadas`)} disabled={!rows.length}>Copiar lista</button>
      {can(user, "pesquisador", "validador") && <button className="btn" onClick={() => setAdd(true)}>Adicionar</button>}
    </div>
    {rows.length ? <table className="t"><thead><tr><th>Marca</th><th>Linha</th><th>Família</th><th>Modelo</th><th>Machine Type</th><th>Código</th><th>Confirmação</th><th>Fonte</th><th>Obs.</th></tr></thead><tbody>
      {rows.map((c: any) => <tr key={c.id}><td>{c.brand}</td><td>{c.line}</td><td>{c.family}</td><td>{c.model}</td><td className="mono">{c.machine_type}</td><td className="mono">{c.machine_code}</td><td><span className={`b ${c.confirmation === "oficial_sku" ? "green" : c.confirmation === "oficial_modelo" ? "blue" : c.confirmation === "necessita_validacao" ? "yellow" : "gray"}`}>{lab("compat", c.confirmation)}</span></td><td><Src r={c} /></td><td className="small">{c.notes}</td></tr>)}
    </tbody></table> : <div className="empty">Nenhuma compatibilidade registrada{d.compat.length ? " com esse filtro" : ""}.</div>}
    {add && <CompatForm d={d} onClose={() => setAdd(false)} done={changed} />}
  </div>;
}
function CompatForm({ d, onClose, done }: { d: any; onClose: () => void; done: () => void }) {
  const [f, setF] = useState<any>({ confirmation: "necessita_validacao", kind: "model", brand: "Lenovo" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save() { try { const r = await api(`/products/${d.product.id}/compat`, { body: f }); toast(`${r.added} compatibilidade(s) adicionadas`); onClose(); done(); } catch (e: any) { toast(e.message, true); } }
  return <Modal title="Adicionar compatibilidades" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Salvar</button></>}>
    <div className="grid2">
      <label className="f"><span>Classificação</span><Select group="compat" value={f.confirmation} onChange={(v) => setF({ ...f, confirmation: v })} /></label>
      <label className="f"><span>Cada linha é</span><select value={f.kind} onChange={s("kind")}><option value="model">Modelo</option><option value="machine_type">Machine Type</option></select></label>
      <label className="f"><span>Marca</span><input value={f.brand} onChange={s("brand")} /></label>
      <label className="f"><span>Linha</span><input value={f.line || ""} onChange={s("line")} placeholder="ThinkPad, ThinkStation…" /></label>
      <label className="f"><span>Link da fonte</span><input value={f.url || ""} onChange={s("url")} /></label>
      <label className="f"><span>Referência da fonte</span><input value={f.reference || ""} onChange={s("reference")} /></label>
    </div>
    <label className="f"><span>Modelos (um por linha)</span><textarea value={f.models || ""} onChange={s("models")} style={{ minHeight: 140 }} /></label>
    <label className="f"><span>Observações</span><input value={f.notes || ""} onChange={s("notes")} /></label>
  </Modal>;
}

// ---------- 4-6. Mercado ----------
function MarketTab({ d, market, competition, changed }: { d: any; market?: string; competition: string; changed: () => void }) {
  const user = useUser();
  const [flt, setFlt] = useState<any>({ mode: "avista" });
  const [add, setAdd] = useState(false);
  const qs = new URLSearchParams(Object.entries(flt).filter(([, v]) => v) as any).toString();
  const { data: st } = useApi<any>(`/products/${d.product.id}/stats?${qs}`, [d]);
  const intl = market === "internacional";
  const all = d.listings.filter((l: any) => (competition === "indireta" ? l.competition === "indireta" : l.competition === "direta" && l.market === market));
  const own = all.filter((l: any) => l.is_own), main = all.filter((l: any) => !l.is_own && !["esgotado", "vendido", "encerrado", "indisponivel"].includes(l.availability)), hist = all.filter((l: any) => !l.is_own && ["esgotado", "vendido", "encerrado", "indisponivel"].includes(l.availability));
  const gk = competition === "indireta" ? "indireta" : intl ? "internacional_direta" : "nacional_direta";
  const g = st?.groups?.[gk];
  async function toggle(l: any) {
    let reason = "";
    if (!l.excluded) { reason = prompt("Motivo para desconsiderar este anúncio dos cálculos:") || ""; if (!reason.trim()) return; }
    try { await api(`/listings/${l.id}`, { method: "PATCH", body: { excluded: !l.excluded, exclusion_reason: reason || null } }); changed(); } catch (e: any) { toast(e.message, true); }
  }
  const empty = competition === "indireta" ? "Nenhuma referência de concorrência indireta. Produtos semelhantes, substitutos e outras gerações aparecem aqui — sem serem tratados como equivalência técnica." : intl ? "Nenhum anúncio internacional registrado." : "Nenhum anúncio nacional registrado. Não foram encontradas ofertas nacionais comparáveis nas pesquisas realizadas até agora.";
  return <div>
    <div className="toolbar">
      <select value={flt.mode} onChange={(e) => setFlt({ ...flt, mode: e.target.value })}><option value="avista">Preço à vista</option><option value="parcelado">Preço parcelado (total)</option></select>
      <Select group="condition" value={flt.condition || ""} onChange={(v) => setFlt({ ...flt, condition: v })} empty="Condição" />
      <Select group="originality" value={flt.originality || ""} onChange={(v) => setFlt({ ...flt, originality: v })} empty="Originalidade" />
      <Select group="availability" value={flt.availability || ""} onChange={(v) => setFlt({ ...flt, availability: v })} empty="Disponibilidade" />
      <Select group="commercial_version" value={flt.version || ""} onChange={(v) => setFlt({ ...flt, version: v })} empty="OEM/TRAY/BOX" />
      <Select group="match_type" value={flt.match_type || ""} onChange={(v) => setFlt({ ...flt, match_type: v })} empty="Correspondência" />
      {can(user, "pesquisador", "validador") && <button className="btn right" onClick={() => setAdd(true)}>+ Anúncio manual</button>}
    </div>
    {g && <div className="card section"><h3>{g.label} {intl && "(em R$, convertido na data da pesquisa)"}</h3><div className="body">
      <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
        {[["Encontrados", num(g.encontrados)], ["Comparáveis", num(g.comparaveis)], ["Disponíveis", num(g.disponiveis)], ["Vendedores", num(g.vendedores)], ["Menor", money(g.menor)], ["Mediana", money(g.mediana)], ["Média", money(g.media)], ["Maior", money(g.maior)], ["Faixa (P25–P75)", g.p25 != null ? `${money(g.p25)} – ${money(g.p75)}` : "—"]].map(([l, v]) => <div className="kpi" key={l as string}><div className="l">{l}</div><div className="v" style={{ fontSize: 15 }}>{v}</div></div>)}
      </div>
      {g.distribuicao?.length > 1 && <div style={{ marginTop: 10 }}><div className="small muted">Distribuição dos valores comparáveis</div><div className="hist">{g.distribuicao.map((b: any, i: number) => <div key={i} title={`${money(b.de)} – ${money(b.ate)}: ${b.n}`} style={{ height: `${(b.n / Math.max(...g.distribuicao.map((x: any) => x.n))) * 100}%` }} />)}</div></div>}
      <div className="small faint" style={{ marginTop: 6 }}>A mediana é a referência estatística inicial, não um preço obrigatório. Cálculo determinístico; a coluna “Cálculo” mostra quem participou e por quê.</div>
    </div></div>}
    <ListingTable rows={main} intl={intl || competition === "indireta"} calc={st?.listings} toggle={toggle} empty={empty} />
    {hist.length > 0 && <div className="section" style={{ marginTop: 14 }}><h4>Anúncios históricos (esgotados, vendidos, encerrados) — referência, fora da concorrência ativa</h4><ListingTable rows={hist} intl={intl} calc={st?.listings} toggle={toggle} /></div>}
    {own.length > 0 && <div className="section" style={{ marginTop: 14 }}><h4>Anúncios da própria Paulicomp — fora dos indicadores de concorrência</h4><ListingTable rows={own} intl={intl} calc={st?.listings} toggle={toggle} /></div>}
    {add && <ListingForm d={d} market={market || "nacional"} competition={competition} onClose={() => setAdd(false)} done={changed} />}
  </div>;
}

function ListingTable({ rows, intl, calc, toggle, empty }: { rows: any[]; intl: boolean; calc?: Record<number, any>; toggle: (l: any) => void; empty?: string }) {
  const user = useUser();
  if (!rows.length) return empty ? <div className="empty">{empty}</div> : null;
  return <div className="tablewrap"><table className="t"><thead><tr>
    <th>Loja / vendedor</th><th>Título</th>{intl && <th>País</th>}<th className="num">{intl ? "Valor original" : "À vista"}</th>{intl ? <><th className="num">Câmbio</th><th className="num">R$</th></> : <th className="num">Parcelado</th>}
    <th>Condição</th><th>Originalidade</th><th>Versão</th><th>Disponibilidade</th><th>Correspondência</th><th>Preço de</th><th>Cálculo</th><th>Link</th><th></th>
  </tr></thead><tbody>
    {rows.map((l) => { const c = calc?.[l.id] || l.calc; return <tr key={l.id} style={l.excluded ? { opacity: .55 } : undefined}>
      <td className="small"><b>{l.store || l.marketplace || "—"}</b>{l.seller && <div className="faint">{l.seller}</div>}{l.is_own && <span className="b blue">Paulicomp</span>}</td>
      <td className="small" style={{ maxWidth: 280 }}><div className="trunc" title={l.title}>{l.title}</div>{l.title_translated && <div className="faint trunc">{l.title_translated}</div>}{(l.sku_informed || l.pn_informed) && <div className="faint mono">{[l.sku_informed, l.pn_informed].filter(Boolean).join(" · ")}</div>}</td>
      {intl && <td className="small">{l.country || "—"}</td>}
      <td className="num">{fmtCur(l.price_original, l.currency)}{l.outlier && <span className="b yellow" title="Preço discrepante no grupo (fora do intervalo interquartil). Apenas sinalizado.">discrepante</span>}</td>
      {intl ? <><td className="num small" title={`${l.fx_source || ""} ${dt(l.fx_at)}`}>{l.fx_rate ? Number(l.fx_rate).toFixed(4) : "—"}</td><td className="num">{money(l.price_brl)}</td></>
        : <td className="num small">{l.price_installment ? `${l.installments}× ${money(l.price_installment)}` : "—"}</td>}
      <td className="small">{lab("condition", l.condition)}</td><td className="small">{lab("originality", l.originality)}</td><td className="small">{lab("commercial_version", l.commercial_version)}</td>
      <td className="small">{lab("availability", l.availability)}</td>
      <td className="small" title={l.match_evidence || ""}>{lab("match_type", l.match_type)}</td>
      <td className="small">{lab("price_origin", l.price_origin)}<div className="faint">{dt(l.collected_at)}</div></td>
      <td className="small">{c?.included ? <span className="b green">Participa</span> : <span className="b gray" title={c?.reason}>Fora</span>}{!c?.included && c?.reason && <div className="faint" style={{ maxWidth: 160 }}>{c.reason}</div>}</td>
      <td><Ext href={l.url}>Ver anúncio ↗</Ext></td>
      <td>{can(user, "pesquisador", "validador") && <button className="btn sm" onClick={() => toggle(l)}>{l.excluded ? "Reincluir" : "Desconsiderar"}</button>}</td>
    </tr>; })}
  </tbody></table></div>;
}

function ListingForm({ d, market, competition, onClose, done }: { d: any; market: string; competition: string; onClose: () => void; done: () => void }) {
  const [f, setF] = useState<any>({ market, competition, currency: market === "internacional" ? "USD" : "BRL", condition: "nova", originality: "nao_confirmada", commercial_version: "nao_identificada", availability: "disponivel", match_type: competition === "indireta" ? "tecnicamente_semelhante" : "mesmo_modelo" });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v ? v.replace(/\./g, "").replace(",", ".") : "");
  async function save() {
    try { const r = await api(`/products/${d.product.id}/listings`, { body: { ...f, price_original: n(f.price_original || ""), price_installment: n(f.price_installment || ""), shipping: n(f.shipping || "") } });
      toast(r.duplicate_of ? `Registrado como duplicado do anúncio #${r.duplicate_of} (fora do cálculo)` : r.is_own ? "Registrado como anúncio da Paulicomp" : "Anúncio registrado"); onClose(); done(); } catch (e: any) { toast(e.message, true); }
  }
  const F = (k: string, l: string, ph = "") => <label className="f"><span>{l}</span><input value={f[k] || ""} onChange={s(k)} placeholder={ph} /></label>;
  return <Modal title="Adicionar anúncio manualmente" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Salvar anúncio</button></>}>
    <div className="note info" style={{ marginBottom: 10 }}>O link direto do anúncio é obrigatório (não use páginas de busca). Valores em moeda estrangeira são convertidos pela PTAX do Banco Central no momento do registro e ficam congelados.</div>
    <div className="grid3">
      <label className="f"><span>Mercado</span><select value={f.market} onChange={s("market")}><option value="nacional">Nacional</option><option value="internacional">Internacional</option></select></label>
      <label className="f"><span>Concorrência</span><select value={f.competition} onChange={s("competition")}><option value="direta">Direta</option><option value="indireta">Indireta</option></select></label>
      <label className="f"><span>Tipo de correspondência *</span><Select group="match_type" value={f.match_type} onChange={(v) => setF({ ...f, match_type: v })} /></label>
      {F("url", "Link direto do anúncio *", "https://")}{F("title", "Título original *")}{F("title_translated", "Título traduzido")}
      {F("store", "Loja")}{F("marketplace", "Marketplace")}{F("seller", "Vendedor")}
      {F("country", "País")}
      <label className="f"><span>Moeda</span><select value={f.currency} onChange={s("currency")}>{["BRL", "USD", "EUR", "GBP", "CNY", "JPY", "CAD"].map((c) => <option key={c}>{c}</option>)}</select></label>
      {F("price_original", "Preço à vista (moeda original)", "0,00")}
      {F("price_installment", "Valor da parcela", "0,00")}{F("installments", "Nº de parcelas")}{F("shipping", "Frete", "0,00")}
      <label className="f"><span>Condição</span><Select group="condition" value={f.condition} onChange={(v) => setF({ ...f, condition: v })} /></label>
      <label className="f"><span>Originalidade</span><Select group="originality" value={f.originality} onChange={(v) => setF({ ...f, originality: v })} /></label>
      <label className="f"><span>Versão comercial</span><Select group="commercial_version" value={f.commercial_version} onChange={(v) => setF({ ...f, commercial_version: v })} /></label>
      <label className="f"><span>Disponibilidade</span><Select group="availability" value={f.availability} onChange={(v) => setF({ ...f, availability: v })} /></label>
      {F("qty_available", "Qtd disponível")}{F("qty_sold", "Qtd vendida")}{F("delivery", "Prazo / encomenda")}
      {F("sku_informed", "SKU informado")}{F("pn_informed", "Part Number informado")}{F("match_evidence", "Evidência da correspondência")}
    </div>
    <label className="f"><span>Observações</span><input value={f.notes || ""} onChange={s("notes")} /></label>
  </Modal>;
}

// ---------- 7. Analise da IA ----------
function AiTab({ d }: { d: any }) {
  const ai = d.aiAll[0];
  const it = d.item || {};
  const st = d.stats || {};
  return <div>
    {!ai ? <div className="note" style={{ marginBottom: 12 }}><b>Nenhuma análise da IA disponível.</b> A integração com a IA ainda não está configurada (ANTHROPIC_API_KEY). Nenhum preço, especificação ou compatibilidade foi gerado automaticamente. Os indicadores abaixo são calculados de forma determinística a partir dos dados já registrados.</div>
      : <div className="card section"><h3>Consolidação v{ai.version} · {ai.model} · {dt(ai.created_at)}</h3><div className="body">
        <div className="kv"><div>Nome comercial</div><div>{ai.output.nome_comercial || "—"}</div><div>Categoria</div><div>{ai.output.categoria || "—"}</div>
          <div>Preço sugerido</div><div>{ai.output.precificacao?.abster ? "A IA se absteve de sugerir preço" : money(ai.output.precificacao?.preco_sugerido)}</div>
          <div>Faixa sugerida</div><div>{money(ai.output.precificacao?.faixa_min)} – {money(ai.output.precificacao?.faixa_max)}</div>
          <div>Preço agressivo (giro)</div><div>{money(ai.output.precificacao?.preco_agressivo)}</div><div>Preço inicial alternativo</div><div>{money(ai.output.precificacao?.preco_inicial_alternativo)}</div>
          <div>Justificativa</div><div>{ai.output.precificacao?.justificativa}</div><div>Limitações</div><div>{(ai.output.precificacao?.limitacoes || []).join("; ")}</div>
          <div>Divergências</div><div>{(ai.output.divergencias || []).join("; ") || "—"}</div></div>
      </div></div>}
    <div className="grid3 section">
      {[["Confiança técnica", it.conf_tech], ["Confiança de compatibilidade", it.conf_compat], ["Confiança comercial", it.conf_com]].map(([l, v]) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v"><Badge s={v} /></div></div>)}
    </div>
    <div className="section"><h4>Indicadores comerciais por grupo (R$)</h4>
      <table className="t"><thead><tr><th>Grupo</th><th className="num">Encontrados</th><th className="num">Comparáveis</th><th className="num">Disponíveis</th><th className="num">Vendedores</th><th className="num">Menor</th><th className="num">Mediana</th><th className="num">Média</th><th className="num">Maior</th></tr></thead>
        <tbody>{Object.entries(st).map(([k, g]: any) => <tr key={k}><td>{g.label}</td><td className="num">{g.encontrados}</td><td className="num">{g.comparaveis}</td><td className="num">{g.disponiveis}</td><td className="num">{g.vendedores}</td><td className="num">{money(g.menor)}</td><td className="num">{money(g.mediana)}</td><td className="num">{money(g.media)}</td><td className="num">{money(g.maior)}</td></tr>)}</tbody></table>
      {st.nacional_direta?.comparaveis === 0 && <div className="small muted" style={{ marginTop: 6 }}>Não foram encontradas ofertas nacionais comparáveis. A ausência de concorrentes não indica, por si só, alta demanda.</div>}
    </div>
    {d.aiAll.length > 1 && <div className="section"><h4>Versões anteriores</h4>{d.aiAll.slice(1).map((a: any) => <div key={a.id} className="small">v{a.version} · {dt(a.created_at)} · {money(a.output?.precificacao?.preco_sugerido)}</div>)}</div>}
  </div>;
}

// ---------- 8. Validacao humana ----------
const VFIELDS: [string, string, "text" | "area" | "cat" | "cond" | "ver" | "orig"][] = [
  ["nome_comercial", "Nome comercial", "text"], ["marca", "Marca", "text"], ["fabricante", "Fabricante", "text"], ["modelo", "Modelo", "text"], ["categoria", "Categoria", "cat"], ["subcategoria", "Subcategoria", "text"],
  ["part_number", "Part Number", "text"], ["codigos_equivalentes", "Códigos equivalentes", "area"], ["compatibilidades", "Compatibilidades", "area"], ["condicao_recebida", "Condição física da peça recebida", "cond"],
  ["versao_comercial", "Versão comercial", "ver"], ["originalidade", "Originalidade", "orig"], ["titulo", "Título", "text"], ["descricao", "Descrição", "area"], ["observacoes", "Observações internas", "area"],
];

function ValidationTab({ d, changed }: { d: any; changed: () => void }) {
  const user = useUser();
  const ai = d.aiAll[0]?.output || {};
  const last = d.techVals[0];
  const init = () => { const base = last?.data || {}; const o: any = {}; for (const [k] of VFIELDS) o[k] = base[k] ?? ai[k] ?? ""; o.especificacoes = base.especificacoes ?? ai.especificacoes_obj ?? {}; return o; };
  const [v, setV] = useState<any>(init);
  const [reason, setReason] = useState("");
  useEffect(() => setV(init()), [d.product.id, last?.id]);
  const cat = d.categories.find((c: any) => c.name === (v.categoria || d.item?.category));
  const aiNewer = d.aiAll[0] && last && new Date(d.aiAll[0].created_at) > new Date(last.created_at);
  const divergent = aiNewer ? VFIELDS.filter(([k]) => ai[k] != null && String(ai[k]) !== String(last.data?.[k] ?? "")) : [];
  const official = (field: string) => d.facts.filter((f: any) => f.confirmation === "oficial" && f.field === field).map((f: any) => f.value)[0];
  async function save(status: string) {
    try { await api(`/products/${d.product.id}/validation`, { body: { data: v, status, reason, lot_id: d.item?.lot_id } }); toast(`Validação técnica: ${statusLabel(status)}`); setReason(""); changed(); } catch (e: any) { toast(e.message, true); }
  }
  const input = (k: string, t: string) => {
    const val = v[k] ?? "", on = (x: string) => setV({ ...v, [k]: x });
    if (t === "area") return <textarea value={val} onChange={(e) => on(e.target.value)} style={{ minHeight: 48 }} />;
    if (t === "cat") return <select value={val} onChange={(e) => on(e.target.value)}><option value="">—</option>{d.categories.map((c: any) => <option key={c.id}>{c.name}</option>)}</select>;
    if (t === "cond") return <Select group="condition" value={val} onChange={on} empty="—" />;
    if (t === "ver") return <Select group="commercial_version" value={val} onChange={on} empty="—" />;
    if (t === "orig") return <Select group="originality" value={val} onChange={on} empty="—" />;
    return <input value={val} onChange={(e) => on(e.target.value)} style={{ width: "100%" }} />;
  };
  const content = buildContent(v, d);
  return <div>
    <div className="note info" style={{ marginBottom: 10 }}>Área independente: os dados originais, as pesquisas e a análise da IA permanecem preservados. Cada salvamento cria uma nova versão com seu nome, data e as alterações campo a campo.
      Validação técnica e validação comercial (preço) são independentes — aprovar o preço não aprova especificações nem compatibilidade.</div>
    {divergent.length > 0 && <div className="note" style={{ marginBottom: 10 }}><b>Nova análise com divergências</b> em relação à validação existente: {divergent.map(([, l]) => l).join(", ")}. Use “↺ IA” no campo para incorporar, se desejar.</div>}
    <CommercialBox d={d} changed={changed} />
    <div className="card section"><h3>Validação técnica {last && <span className="faint" style={{ textTransform: "none" }}>· v{last.version} {statusLabel(last.status)} por {last.user_name} em {dt(last.created_at)}</span>}</h3><div className="body">
      <table className="t"><thead><tr><th style={{ width: 190 }}>Campo</th><th style={{ width: "34%" }}>Informação da IA</th><th>Informação validada</th><th style={{ width: 50 }}></th></tr></thead><tbody>
        {VFIELDS.map(([k, l, t]) => { const aiv = ai[k]; const changedF = aiv != null && String(aiv) !== String(v[k] ?? ""); const off = k === "nome_comercial" ? official("Nomenclatura oficial Lenovo") : null; return <tr key={k}>
          <td>{l}</td><td className="small">{aiv != null && aiv !== "" ? String(aiv) : <span className="faint">—</span>}{off && <div className="faint">Oficial Lenovo: {off}</div>}</td>
          <td className={changedF ? "changed" : ""}>{input(k, t)}</td>
          <td>{aiv != null && <button className="iconbtn" title="Restaurar sugestão original da IA" onClick={() => setV({ ...v, [k]: aiv })}>↺ IA</button>}</td></tr>; })}
        <tr><td colSpan={4}><b>Especificações{cat ? ` — ${cat.name}` : ""}</b> <span className="faint small">(campos configuráveis por categoria; deixe vazio o que não foi confirmado)</span></td></tr>
        {(cat?.fields || []).map((f: any) => <tr key={f.key}><td>{f.label}</td><td className="small">{ai.especificacoes_obj?.[f.label] ?? <span className="faint">—</span>}</td>
          <td><input style={{ width: "100%" }} value={v.especificacoes?.[f.label] ?? ""} onChange={(e) => setV({ ...v, especificacoes: { ...v.especificacoes, [f.label]: e.target.value } })} /></td><td /></tr>)}
      </tbody></table>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <input placeholder="Motivo da alteração (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 300 }} />
        {can(user, "pesquisador", "validador") && <button className="btn" onClick={() => save("rascunho")}>Salvar rascunho</button>}
        {can(user, "pesquisador", "validador") && <button className="btn" onClick={() => save("revisao_solicitada")}>Solicitar revisão</button>}
        {can(user, "validador") && <button className="btn danger" onClick={() => save("nao_identificado")}>Marcar não identificado</button>}
        {can(user, "validador") && <button className="btn ok" onClick={() => save("aprovada")}>Aprovar dados técnicos</button>}
      </div>
    </div></div>
    <div className="card section"><h3>Conteúdo para cadastro (somente dados validados)</h3><div className="body">
      {last?.status !== "aprovada" && <div className="note" style={{ marginBottom: 8 }}>Validação técnica ainda não aprovada — conteúdo abaixo é prévia e não deve ser publicado.</div>}
      {content.map(([l, t]) => <div key={l} className="section"><div className="row"><b className="small">{l}</b><button className="btn sm right" onClick={() => copy(t)} disabled={!t}>Copiar</button></div><pre className="small" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 8, borderRadius: 4, margin: "4px 0 0", minHeight: 22 }}>{t || "—"}</pre></div>)}
    </div></div>
  </div>;
}

function buildContent(v: any, d: any): [string, string][] {
  const specs = Object.entries(v.especificacoes || {}).filter(([, x]) => String(x).trim());
  const nome = [v.nome_comercial].filter(Boolean).join(" ");
  const codes = [v.part_number && `PN ${v.part_number}`, d.item?.fru && `FRU ${d.item.fru}`].filter(Boolean).join(" ");
  const compat = String(v.compatibilidades || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return [
    ["Nome comercial padronizado", nome],
    ["Título para e-commerce", [nome, v.versao_comercial && v.versao_comercial !== "nao_identificada" ? lab("commercial_version", v.versao_comercial) : "", codes].filter(Boolean).join(" - ").slice(0, 150)],
    ["Título para marketplace (60 caracteres)", [nome, codes].filter(Boolean).join(" ").slice(0, 60)],
    ["Descrição curta", v.descricao ? String(v.descricao).split("\n")[0] : nome],
    ["Descrição técnica completa", [v.descricao, specs.length ? "Especificações:\n" + specs.map(([k, x]) => `- ${k}: ${x}`).join("\n") : "", compat.length ? "Compatível com:\n" + compat.map((c) => `- ${c}`).join("\n") : ""].filter(Boolean).join("\n\n")],
    ["Lista de especificações", specs.map(([k, x]) => `${k}: ${x}`).join("\n")],
    ["Lista de compatibilidades", compat.join("\n")],
    ["Palavras-chave", [...new Set([v.marca, v.fabricante, v.modelo, v.part_number, d.item?.fru, d.product.sku, v.categoria].filter(Boolean))].join(", ")],
  ];
}

function CommercialBox({ d, changed }: { d: any; changed: () => void }) {
  const user = useUser();
  const it = d.item;
  const [p, setP] = useState("");
  const [notes, setNotes] = useState("");
  if (!it) return null;
  async function save(status: string) {
    const n = Number(p.replace(/\./g, "").replace(",", "."));
    try { await api(`/items/${it.id}/price`, { body: { unit_price: p ? n : null, status, notes: notes || undefined } }); toast(status === "aprovada" ? "Preço aprovado" : "Salvo"); setP(""); changed(); } catch (e: any) { toast(e.message, true); }
  }
  return <div className="card section"><h3>Validação comercial — lote {it.lot_code} ({num(it.quantity)} unidades)</h3><div className="body">
    <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", marginBottom: 10 }}>
      <div className="kpi"><div className="l">Preço sugerido IA</div><div className="v" style={{ fontSize: 16 }}>{it.ai_abstained ? "absteve-se" : money(it.ai_price)}</div></div>
      <div className="kpi"><div className="l">Mediana nacional</div><div className="v" style={{ fontSize: 16 }}>{money(it.nat_median)}</div></div>
      <div className="kpi"><div className="l">Mediana internacional</div><div className="v" style={{ fontSize: 16 }}>{money(it.int_median)}</div></div>
      <div className="kpi main"><div className="l">Preço aprovado</div><div className="v" style={{ fontSize: 16 }}>{money(it.approved_price)}</div></div>
      <div className="kpi main"><div className="l">Total validado</div><div className="v" style={{ fontSize: 16 }}>{it.total_validated != null ? money(it.total_validated) : "Pendente"}</div></div>
    </div>
    {can(user, "pesquisador", "validador") && <div className="row wrap">
      <input placeholder="Preço unitário (R$)" value={p} onChange={(e) => setP(e.target.value)} style={{ width: 160 }} />
      <input placeholder="Observação" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 260 }} />
      <button className="btn" onClick={() => save("rascunho")}>Salvar rascunho</button>
      <button className="btn" onClick={() => save("revisao_solicitada")}>Solicitar revisão</button>
      {can(user, "validador") && <button className="btn ok" onClick={() => save("aprovada")}>Aprovar preço</button>}
    </div>}
    {d.comVals.length > 0 && <table className="t" style={{ marginTop: 10 }}><thead><tr><th>Versão</th><th>Status</th><th className="num">Preço</th><th>Por</th><th>Quando</th><th>Obs.</th></tr></thead><tbody>
      {d.comVals.map((c: any) => <tr key={c.id}><td>v{c.version}</td><td><Badge s={c.status} /></td><td className="num">{money(c.unit_price)}</td><td>{c.user_name}</td><td className="small">{dt(c.created_at)}</td><td className="small">{c.notes}</td></tr>)}
    </tbody></table>}
  </div></div>;
}

// ---------- 9. Historico ----------
function HistoryTab({ d }: { d: any }) {
  const [open, setOpen] = useState<number | null>(null);
  return <div>
    <div className="section"><h4>Pesquisas</h4>
      {d.runs.length ? <table className="t"><thead><tr><th>#</th><th>Tipo</th><th>Status</th><th>Criada</th><th>Concluída</th><th>Resumo</th><th className="num">Custo (US$)</th><th></th></tr></thead><tbody>
        {d.runs.map((r: any) => <Fragment key={r.id}><tr><td>{r.id}</td><td>{r.kind}</td><td><Badge s={r.status} /></td><td className="small">{dt(r.created_at)}</td><td className="small">{dt(r.finished_at)}</td><td className="small">{r.summary}</td><td className="num">{Number(r.cost_usd).toFixed(3)}</td><td><button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>Etapas</button></td></tr>
          {open === r.id && <tr><td colSpan={8}><StepList steps={r.steps || []} /></td></tr>}</Fragment>)}
      </tbody></table> : <div className="faint">Nenhuma pesquisa executada.</div>}
    </div>
    <div className="section"><h4>Alterações</h4>
      {d.history.length ? <table className="t"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Campo</th><th>Anterior</th><th>Novo</th><th>Motivo</th></tr></thead><tbody>
        {d.history.map((h: any) => <tr key={h.id}><td className="small">{dt(h.created_at)}</td><td>{h.user_name || "sistema"}</td><td className="small">{h.action.replace(/_/g, " ")}</td><td className="small">{h.field}</td>
          <td className="small mono trunc" style={{ maxWidth: 200 }} title={JSON.stringify(h.old_value)}>{h.old_value == null ? "" : JSON.stringify(h.old_value)}</td><td className="small mono trunc" style={{ maxWidth: 240 }} title={JSON.stringify(h.new_value)}>{h.new_value == null ? "" : JSON.stringify(h.new_value)}</td><td className="small">{h.reason}</td></tr>)}
      </tbody></table> : <div className="faint">Sem alterações registradas.</div>}
    </div>
  </div>;
}

export function StepList({ steps, labels }: { steps: any[]; labels?: Record<string, string> }) {
  return <table className="t"><thead><tr><th>Etapa</th><th>Fonte</th><th>Obrigatória</th><th>Status</th><th className="num">Tentativas</th><th>Início</th><th>Fim</th><th>Erro / detalhe</th></tr></thead><tbody>
    {steps.map((s: any) => <tr key={s.id}><td>{labels?.[s.step] || s.step.replace(/_/g, " ")}</td><td className="small">{s.source}</td><td className="small">{s.required ? "Sim" : "Não"}</td><td><Badge s={s.status} /></td><td className="num">{s.attempts}</td><td className="small">{dt(s.started_at)}</td><td className="small">{dt(s.finished_at)}</td>
      <td className="small" style={{ maxWidth: 380 }}>{s.error}{(s.log || []).map((l: any, i: number) => <div key={i} className="faint">{l.msg}{l.data ? `: ${JSON.stringify(l.data)}` : ""}</div>)}</td></tr>)}
  </tbody></table>;
}
