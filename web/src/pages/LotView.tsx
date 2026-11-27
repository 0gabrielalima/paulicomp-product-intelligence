import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi, money, num, pct, dt, dateOnly, Badge, Kpi, Modal, toast, copy, can, useUser, Ext } from "../ui.tsx";
import { ProductPanel } from "./ProductPanel.tsx";
import { ResearchModal } from "./Research.tsx";

type Item = any;
const EXTRA_COLS: [string, string][] = [
  ["fru", "FRU oficial"], ["original_description", "Nomenclatura Lenovo"], ["nat_min", "Menor preço nacional"], ["nat_median", "Mediana nacional"], ["int_median", "Mediana internacional (R$)"],
  ["ads", "Anúncios (nac/int/ind)"], ["compat_count", "Compatibilidades"], ["conf_tech", "Confiança técnica"], ["conf_com", "Confiança comercial"],
  ["total_ai", "Valor total sugerido IA"], ["validator", "Responsável"], ["research_at", "Última pesquisa"],
];
const DEFAULT_STATE = { q: "", category: "", research: "", tech: "", com: "", flags: "", conf: "", existed: "", sort: { key: "", dir: 1 }, cols: [] as string[] };

function usePersisted<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { return { ...init, ...JSON.parse(sessionStorage.getItem(key) || "{}") }; } catch { return init; } });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* sem storage */ } }, [key, v]);
  return [v, setV] as const;
}

export function LotView({ lotId }: { lotId: number }) {
  const user = useUser();
  const { data, error, setData, reload } = useApi<any>(`/lots/${lotId}`);
  const [st, setSt] = usePersisted(`lot:${lotId}:state`, DEFAULT_STATE);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [colMenu, setColMenu] = useState(false);
  const [modal, setModal] = useState<"" | "lenovo" | "research" | "export">("");
  const tableRef = useRef<HTMLDivElement>(null);
  const set = (p: Partial<typeof DEFAULT_STATE>) => setSt((s) => ({ ...s, ...p }));

  const items: Item[] = data?.items || [];
  const categories = useMemo(() => [...new Set(items.map((i) => i.category || "Sem categoria"))].sort(), [items]);
  const validators = useMemo(() => [...new Set(items.map((i) => i.validator).filter(Boolean))].sort(), [items]);

  const view = useMemo(() => {
    const q = st.q.trim().toLowerCase();
    let xs = items.filter((i) =>
      (!q || [i.sku, i.name, i.original_description, i.fru].some((v) => v && String(v).toLowerCase().includes(q))) &&
      (!st.category || (i.category || "Sem categoria") === st.category) &&
      (!st.research || i.research_status === st.research) &&
      (!st.tech || i.tech_status === st.tech) &&
      (!st.com || (st.com === "sem_preco" ? i.approved_price == null : st.com === "aprovada" ? i.approved_price != null : i.com_status === st.com)) &&
      (!st.flags || (st.flags === "sem_compat" ? !i.compat_official : st.flags === "sem_nacional" ? i.nat_count === 0 : st.flags === "completo" ? i.full_status === "aprovado" : st.flags.startsWith("resp:") ? i.validator === st.flags.slice(5) : true)) &&
      (!st.conf || i.conf_tech === st.conf || i.conf_com === st.conf) &&
      (!st.existed || (st.existed === "sim" ? i.existed_before : !i.existed_before)));
    if (st.sort.key) {
      const k = st.sort.key, d = st.sort.dir;
      const val = (i: Item) => k === "name" ? (i.name || i.original_description || "") : k === "unit" ? (i.approved_price ?? i.ai_price ?? null) : k === "conf" ? ["insuficiente", "baixa", "media", "alta"].indexOf(i.conf_com) : k === "status" ? `${i.tech_status}${i.com_status}` : i[k];
      xs = [...xs].sort((a, b) => { const va = val(a), vb = val(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * d; });
    }
    return xs;
  }, [items, st]);

  const filtered = view.length !== items.length;
  const fin = useMemo(() => summarize(view), [view]);
  const finAll = useMemo(() => summarize(items), [items]);

  // navegacao por teclado na lista
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (open != null || (e.target as HTMLElement).closest("input,select,textarea")) return;
      const idx = view.findIndex((i) => i.id === active);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = view[Math.min(view.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) { setActive(n.id); document.getElementById(`row-${n.id}`)?.scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "Enter" && active != null) setOpen(active);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [view, active, open]);

  if (error) return <div className="note">{error}</div>;
  if (!data) return <div className="empty">Carregando…</div>;
  const h = data.header;

  const sortBy = (key: string) => set({ sort: { key, dir: st.sort.key === key ? -st.sort.dir : key.match(/total|quantity|unit/) ? -1 : 1 } });
  const arrow = (key: string) => (st.sort.key === key ? (st.sort.dir > 0 ? " ▲" : " ▼") : "");
  const has = (c: string) => st.cols.includes(c);
  const toggleAll = () => setSel(sel.size === view.length ? new Set() : new Set(view.map((i) => i.id)));
  const onItemChanged = (item: Item, header?: any) => setData((d: any) => ({ ...d, items: d.items.map((x: Item) => (x.id === item.id ? item : x)), header: header || d.header }));

  async function bulkApproveAi() {
    const targets = items.filter((i) => sel.has(i.id) && i.ai_price != null && i.approved_price == null);
    if (!targets.length) return toast("Nenhum item selecionado possui preço sugerido pela IA pendente de aprovação.", true);
    if (!confirm(`Aprovar o preço sugerido pela IA como preço validado em ${targets.length} item(ns)? Cada aprovação fica registrada no histórico em seu nome.`)) return;
    for (const t of targets) await api(`/items/${t.id}/price`, { body: { unit_price: t.ai_price, status: "aprovada", reason: "Aprovação em massa do preço sugerido pela IA" } });
    toast(`${targets.length} preço(s) aprovados`); reload();
  }

  const openIdx = view.findIndex((i) => i.id === open);
  const openItem = items.find((i) => i.id === open);

  return <div>
    <div className="row" style={{ marginBottom: 10 }}>
      <a href="#/lotes" className="small">← Lotes</a>
      <h2 style={{ margin: 0, fontSize: 18 }}>{data.lot.code}</h2>
      <span className="muted small">Recebido em {dateOnly(data.lot.received_at)} · arquivo {data.lot.source_filename} · aba {data.lot.sheet_name}</span>
    </div>
    <div className="lothead">
      <Kpi l="Potencial validado" v={money(h.potential_validated)} main title="Soma de quantidade × preço unitário APROVADO. Itens pendentes não entram." />
      <Kpi l="Potencial sugerido IA" v={money(h.potential_ai)} title="Soma de quantidade × preço sugerido pela IA (referência, não oficial)." />
      <Kpi l="SKUs únicos" v={num(h.skus)} />
      <Kpi l="Unidades recebidas" v={num(h.units)} />
      <Kpi l="SKUs pesquisados" v={`${num(h.researched)} · ${pct(h.pct_research)}`} />
      <Kpi l="SKUs validados" v={`${num(h.validated)} · ${pct(h.pct_validation)}`} title="Validação técnica aprovada + preço aprovado" />
      <Kpi l="SKUs pendentes" v={num(h.pending)} />
      <Kpi l="Unid. com preço validado" v={num(h.units_approved)} />
      <Kpi l="Unid. sem preço validado" v={num(h.units_pending)} />
    </div>

    <div className="toolbar">
      <input type="search" placeholder="Buscar na lista (SKU, nome, nomenclatura, FRU)" value={st.q} onChange={(e) => set({ q: e.target.value })} style={{ width: 280 }} />
      <select value={st.category} onChange={(e) => set({ category: e.target.value })}><option value="">Categoria</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
      <select value={st.research} onChange={(e) => set({ research: e.target.value })}><option value="">Pesquisa</option>{["nao_pesquisado", "na_fila", "em_andamento", "parcial", "concluida", "falha", "pausada", "cancelada"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <select value={st.tech} onChange={(e) => set({ tech: e.target.value })}><option value="">Validação técnica</option>{["pendente", "rascunho", "aprovada", "revisao_solicitada", "nao_identificado"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <select value={st.com} onChange={(e) => set({ com: e.target.value })}><option value="">Validação comercial</option><option value="sem_preco">Sem preço validado</option><option value="aprovada">Preço aprovado</option><option value="rascunho">Rascunho</option><option value="revisao_solicitada">Revisão solicitada</option></select>
      <select value={st.flags} onChange={(e) => set({ flags: e.target.value })}><option value="">Outros filtros</option><option value="sem_compat">Sem compatibilidade confirmada</option><option value="sem_nacional">Sem concorrência nacional</option><option value="completo">Aprovação completa</option>{validators.map((v) => <option key={v} value={`resp:${v}`}>Responsável: {v}</option>)}</select>
      <select value={st.conf} onChange={(e) => set({ conf: e.target.value })}><option value="">Confiança</option>{["alta", "media", "baixa", "insuficiente"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <select value={st.existed} onChange={(e) => set({ existed: e.target.value })}><option value="">Base</option><option value="sim">Já existentes na base</option><option value="nao">Novos</option></select>
      {(filtered || st.sort.key) && <button className="btn sm" onClick={() => set({ ...DEFAULT_STATE, cols: st.cols })}>Limpar</button>}
      <div className="right row">
        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => setColMenu((x) => !x)}>Colunas ▾</button>
          {colMenu && <div className="colmenu" style={{ right: 0, top: 34 }} onMouseLeave={() => setColMenu(false)}>
            {EXTRA_COLS.map(([k, l]) => <label key={k} className="row small"><input type="checkbox" checked={has(k)} onChange={() => set({ cols: has(k) ? st.cols.filter((c) => c !== k) : [...st.cols, k] })} />{l}</label>)}
          </div>}
        </div>
        <button className="btn" onClick={() => setModal("lenovo")}>Consulta Lenovo</button>
        <button className="btn" onClick={() => setModal("export")}>Exportar</button>
        {can(user, "pesquisador") && <button className="btn primary" onClick={() => setModal("research")}>Pesquisar…</button>}
      </div>
    </div>
    {sel.size > 0 && <div className="toolbar note info" style={{ padding: "6px 10px" }}>
      <b>{sel.size} selecionado(s)</b>
      {can(user, "pesquisador") && <button className="btn sm" onClick={() => setModal("research")}>Pesquisar selecionados</button>}
      {can(user, "validador") && <button className="btn sm" onClick={bulkApproveAi}>Aprovar preço da IA nos selecionados</button>}
      <button className="btn sm" onClick={() => window.open(`/api/lots/${lotId}/export.xlsx?scope=selecionados&ids=${[...sel].join(",")}`)}>Exportar selecionados</button>
      <button className="btn sm" onClick={() => setSel(new Set())}>Limpar seleção</button>
    </div>}

    <div className="tablewrap" ref={tableRef} style={{ maxHeight: "calc(100vh - 330px)" }}>
      <table className="t">
        <thead><tr>
          <th style={{ width: 28 }}><input type="checkbox" checked={sel.size > 0 && sel.size === view.length} onChange={toggleAll} /></th>
          <th className="sort" onClick={() => sortBy("name")}>Produto{arrow("name")}</th>
          <th className="sort" onClick={() => sortBy("category")}>Categoria{arrow("category")}</th>
          <th className="sort num" onClick={() => sortBy("quantity")}>Qtd{arrow("quantity")}</th>
          <th className="sort num" onClick={() => sortBy("ai_price")}>Preço IA{arrow("ai_price")}</th>
          <th className="sort num" onClick={() => sortBy("approved_price")}>Preço validado{arrow("approved_price")}</th>
          <th className="sort num" onClick={() => sortBy("total_validated")}>Total validado{arrow("total_validated")}</th>
          {has("fru") && <th>FRU</th>}
          {has("original_description") && <th>Nomenclatura Lenovo</th>}
          {has("nat_min") && <th className="sort num" onClick={() => sortBy("nat_min")}>Menor nac.{arrow("nat_min")}</th>}
          {has("nat_median") && <th className="sort num" onClick={() => sortBy("nat_median")}>Mediana nac.{arrow("nat_median")}</th>}
          {has("int_median") && <th className="sort num" onClick={() => sortBy("int_median")}>Mediana int.{arrow("int_median")}</th>}
          {has("ads") && <th className="num">Anúncios</th>}
          {has("compat_count") && <th className="sort num" onClick={() => sortBy("compat_count")}>Compat.{arrow("compat_count")}</th>}
          {has("conf_tech") && <th>Conf. técnica</th>}
          {has("conf_com") && <th className="sort" onClick={() => sortBy("conf")}>Conf. comercial{arrow("conf")}</th>}
          {has("total_ai") && <th className="sort num" onClick={() => sortBy("total_ai")}>Total IA{arrow("total_ai")}</th>}
          {has("validator") && <th>Responsável</th>}
          {has("research_at") && <th className="sort" onClick={() => sortBy("research_at")}>Últ. pesquisa{arrow("research_at")}</th>}
          <th className="sort" onClick={() => sortBy("research_status")}>Pesquisa{arrow("research_status")}</th>
          <th className="sort" onClick={() => sortBy("status")}>Validação{arrow("status")}</th>
          <th style={{ width: 24 }}></th>
        </tr></thead>
        <tbody>
          {view.map((i) => <tr key={i.id} id={`row-${i.id}`} className={`click ${sel.has(i.id) ? "sel" : ""} ${active === i.id || open === i.id ? "active" : ""}`} onClick={() => { setActive(i.id); setOpen(i.id); }}>
            <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(i.id)} onChange={() => { const s = new Set(sel); s.has(i.id) ? s.delete(i.id) : s.add(i.id); setSel(s); }} /></td>
            <td className="namecell"><div className="n trunc" title={i.name || ""}>{i.name || <span className="faint" style={{ fontWeight: 400 }}>Não identificado ainda</span>}</div>
              <div className="s"><span className="mono">{i.sku}</span> · <span className="trunc" style={{ display: "inline-block", maxWidth: 300, verticalAlign: "bottom" }} title={i.original_description}>{i.original_description}</span>{i.existed_before && <span className="b blue" style={{ marginLeft: 4 }} title="SKU já existia na base">base</span>}</div></td>
            <td className="small">{i.category || "—"}{i.category_source === "commodity" && <span className="faint" title="Categoria inferida do campo Commodity da Lenovo (não validada)"> *</span>}</td>
            <td className="num">{num(i.quantity)}</td>
            <td className="num">{i.ai_abstained ? <span className="faint small" title="A IA se absteve por falta de referências confiáveis">absteve-se</span> : money(i.ai_price)}</td>
            <td className="num" onClick={(e) => e.stopPropagation()}><PriceCell item={i} onSaved={onItemChanged} /></td>
            <td className="num">{i.total_validated != null ? <b>{money(i.total_validated)}</b> : <span className="pending-v">Pendente</span>}</td>
            {has("fru") && <td className="mono">{i.fru || "—"}</td>}
            {has("original_description") && <td className="small trunc">{i.original_description}</td>}
            {has("nat_min") && <td className="num">{money(i.nat_min)}</td>}
            {has("nat_median") && <td className="num">{money(i.nat_median)}</td>}
            {has("int_median") && <td className="num">{money(i.int_median)}</td>}
            {has("ads") && <td className="num small">{i.nat_count}/{i.int_count}/{i.ind_count}</td>}
            {has("compat_count") && <td className="num">{i.compat_count}{i.compat_official ? <span className="faint small"> ({i.compat_official} of.)</span> : ""}</td>}
            {has("conf_tech") && <td><Badge s={i.conf_tech} /></td>}
            {has("conf_com") && <td><Badge s={i.conf_com} /></td>}
            {has("total_ai") && <td className="num">{money(i.total_ai)}</td>}
            {has("validator") && <td className="small">{i.validator || "—"}</td>}
            {has("research_at") && <td className="small">{dt(i.research_at)}</td>}
            <td><Badge s={i.research_status} /></td>
            <td><div className="row" style={{ gap: 3 }}><Badge s={i.tech_status} prefix="Téc: " /><Badge s={i.approved_price != null ? "aprovada" : i.com_status} prefix="Com: " /></div></td>
            <td className="faint">›</td>
          </tr>)}
          {!view.length && <tr><td colSpan={30} className="empty">Nenhum produto com os filtros atuais.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="finbar">
      <span>{filtered ? <b>Filtrados ({num(view.length)} SKUs)</b> : <b>Lote completo</b>}</span>
      <span>Unidades <b>{num(fin.units)}</b></span>
      <span>Com preço aprovado <b>{num(fin.unitsOk)}</b></span>
      <span>Aguardando aprovação <b>{num(fin.units - fin.unitsOk)}</b></span>
      <span>% validado <b>{pct(fin.units ? (fin.unitsOk / fin.units) * 100 : 0)}</b></span>
      <span className="hl">Potencial validado <b>{money(fin.totalOk)}</b></span>
      <span>Sugerido IA <b>{money(fin.totalAi)}</b></span>
      {filtered && <><span className="sep" /><span>Lote completo: <b>{money(finAll.totalOk)}</b> validado · <b>{num(finAll.units)}</b> unid.</span></>}
    </div>

    {open != null && openItem && <ProductPanel productId={openItem.product_id} itemId={open} onClose={() => setOpen(null)}
      onChanged={() => reload()}
      nav={{ index: openIdx, total: view.length, prev: openIdx > 0 ? () => { setOpen(view[openIdx - 1].id); setActive(view[openIdx - 1].id); } : undefined, next: openIdx >= 0 && openIdx < view.length - 1 ? () => { setOpen(view[openIdx + 1].id); setActive(view[openIdx + 1].id); } : undefined }} />}
    {modal === "lenovo" && <LenovoModal lotId={lotId} onClose={() => { setModal(""); reload(); }} />}
    {modal === "research" && <ResearchModal lotId={lotId} itemIds={sel.size ? [...sel] : undefined} onClose={() => { setModal(""); reload(); }} />}
    {modal === "export" && <ExportModal lotId={lotId} sel={[...sel]} onClose={() => setModal("")} />}
  </div>;
}

const label = (s: string) => ({ nao_pesquisado: "Não pesquisado", na_fila: "Na fila", em_andamento: "Em andamento", parcial: "Parcial", concluida: "Concluída", falha: "Falha", pausada: "Pausada", cancelada: "Cancelada", pendente: "Pendente", rascunho: "Rascunho", aprovada: "Aprovada", revisao_solicitada: "Revisão solicitada", nao_identificado: "Não identificado", alta: "Alta", media: "Média", baixa: "Baixa", insuficiente: "Insuficiente" } as Record<string, string>)[s] || s;

function summarize(xs: Item[]) {
  let units = 0, unitsOk = 0, totalOk = 0, totalAi = 0;
  for (const i of xs) { units += i.quantity; if (i.approved_price != null) { unitsOk += i.quantity; totalOk += i.total_validated; } if (i.total_ai != null) totalAi += i.total_ai; }
  return { units, unitsOk, totalOk: Math.round(totalOk * 100) / 100, totalAi: Math.round(totalAi * 100) / 100 };
}

/** Validacao rapida de preco (comercial), independente da aprovacao tecnica. */
export function PriceCell({ item, onSaved }: { item: Item; onSaved: (it: Item, header?: any) => void }) {
  const user = useUser();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState("");
  const canEdit = can(user, "validador", "pesquisador");
  async function save(status: "aprovada" | "rascunho") {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    if (status === "aprovada" && !(n > 0)) return toast("Informe um preço válido.", true);
    try {
      const r = await api(`/items/${item.id}/price`, { body: { unit_price: v ? n : null, status } });
      onSaved(r.item, r.header); setEdit(false);
      toast(status === "aprovada" ? `Preço aprovado: ${money(n)} × ${num(item.quantity)} = ${money(r.item.total_validated)}` : "Rascunho salvo (não altera o valor oficial)");
    } catch (e: any) { toast(e.message, true); }
  }
  if (edit) return <div className="priceedit">
    <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(can(user, "validador") ? "aprovada" : "rascunho"); if (e.key === "Escape") setEdit(false); }} placeholder="0,00" />
    {can(user, "validador") && <button className="btn sm ok" title="Aprovar preço (Enter)" onClick={() => save("aprovada")}>✓</button>}
    <button className="btn sm" title="Salvar rascunho" onClick={() => save("rascunho")}>R</button>
    <button className="iconbtn" onClick={() => setEdit(false)}>✕</button>
  </div>;
  const start = () => { if (!canEdit) return; const base = item.approved_price ?? item.com_last_price ?? item.ai_price; setV(base != null ? String(base).replace(".", ",") : ""); setEdit(true); };
  return <span onClick={start} style={{ cursor: canEdit ? "text" : "default" }} title={canEdit ? "Clique para validar ou alterar o preço unitário" : ""}>
    {item.approved_price != null ? <b>{money(item.approved_price)}</b> : <span className="pending-v">Pendente</span>}
    {item.has_draft_after_approval && <span className="b yellow" title={`Rascunho de ${money(item.com_last_price)} não aprovado`} style={{ marginLeft: 4 }}>R</span>}
    {item.approved_price == null && item.com_status === "rascunho" && <span className="faint small"> ({money(item.com_last_price)} rasc.)</span>}
  </span>;
}

function LenovoModal({ lotId, onClose }: { lotId: number; onClose: () => void }) {
  const { data } = useApi<any>(`/lots/${lotId}/lenovo`);
  const [up, setUp] = useState<any>(null);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [consulted, setConsulted] = useState("");
  const FIELDS: [string, string][] = [["sku", "SKU consultado *"], ["fru", "Nº da peça de serviço (FRU)"], ["official_name", "Título / nome oficial"], ["commodity", "Mercadoria / commodity"], ["machine_types", "Compatibilidade (machine types)"], ["substitutes", "Substitutos / equivalentes"], ["images", "Links de imagens"]];
  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await api("/lenovo/upload", { form: fd });
      const guess: Record<string, number | null> = {};
      const find = (re: RegExp) => { const i = r.headers.findIndex((h: string) => re.test(h)); return i >= 0 ? i : null; };
      guess.sku = find(/consult|pesquis|searched|input|sku/i); guess.fru = find(/servi[cç]o|service|fru|part ?n/i); guess.official_name = find(/t[ií]tulo|title|descri/i);
      guess.commodity = find(/mercadoria|commodity/i); guess.machine_types = find(/compat|machine|produto|product/i); guess.substitutes = find(/substitu/i); guess.images = find(/imag|foto|photo/i);
      setUp(r); setMap(guess);
    } catch (e: any) { toast(e.message, true); }
  }
  async function commit() {
    try {
      const r = await api("/lenovo/commit", { body: { token: up.token, sheet: up.sheet, header_row: up.header_row, mapping: map, consulted_at: consulted || undefined } });
      toast(`${r.recorded} SKU(s) registrados como fonte oficial Lenovo${r.unmatched.length ? `; ${r.unmatched.length} não pertencem à base` : ""}`);
      if (r.unmatched.length) alert(`SKUs do arquivo que não existem na base:\n${r.unmatched.join(", ")}`);
      onClose();
    } catch (e: any) { toast(e.message, true); }
  }
  return <Modal title="Consulta oficial Lenovo Parts Lookup (semiautomática)" onClose={onClose} wide footer={up ? <><button className="btn" onClick={() => setUp(null)}>Voltar</button><button className="btn primary" onClick={commit} disabled={map.sku == null}>Importar resultado</button></> : undefined}>
    {!up ? <>
      <div className="note info" style={{ marginBottom: 12 }}>
        A Lenovo não oferece API pública para o Parts Lookup. Fluxo: <b>1)</b> copie um bloco (até 100 SKUs); <b>2)</b> abra o <Ext href={data?.url || "https://support.lenovo.com/br/pt/parts-lookup"}>Parts Lookup ↗</Ext>, escolha <b>“Número da Peça”</b>, cole e clique em Enviar;
        <b> 3)</b> baixe a <b>“Lista de downloads”</b> e importe abaixo — ou registre um SKU individual na aba “Pesquisa técnica” do produto. O site mostra o SKU do lote como “Desconhecido” e devolve o <b>número da peça de serviço (FRU)</b> correspondente.
      </div>
      <table className="t"><thead><tr><th>Bloco</th><th className="num">SKUs</th><th className="num">Já registrados</th><th>Conteúdo</th><th></th></tr></thead>
        <tbody>{(data?.batches || []).map((b: any, n: number) => <tr key={b.id}><td>#{n + 1}</td><td className="num">{b.skus.length}</td><td className="num">{b.done}/{b.skus.length}</td>
          <td className="mono small trunc" style={{ maxWidth: 520 }}>{b.text}</td><td><button className="btn sm" onClick={() => copy(b.text, `Bloco #${n + 1} copiado (${b.skus.length} SKUs)`)}>Copiar bloco</button></td></tr>)}</tbody></table>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="btn primary">Importar arquivo de resultados (XLS/XLSX/CSV)<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      </div>
    </> : <>
      <div className="muted" style={{ marginBottom: 8 }}>Arquivo <b>{up.filename}</b> · aba {up.sheet} · {up.total_rows} linhas. Relacione as colunas (o formato do arquivo da Lenovo pode variar):</div>
      <div className="grid3" style={{ marginBottom: 10 }}>{FIELDS.map(([k, l]) => <label className="f" key={k}><span>{l}</span>
        <select value={map[k] ?? ""} onChange={(e) => setMap({ ...map, [k]: e.target.value === "" ? null : Number(e.target.value) })}><option value="">— não usar —</option>{up.headers.map((h: string, i: number) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}</select></label>)}
        <label className="f"><span>Data/hora da consulta no site</span><input type="datetime-local" value={consulted} onChange={(e) => setConsulted(e.target.value)} /></label></div>
      <div className="tablewrap" style={{ maxHeight: 300 }}><table className="t"><thead><tr>{up.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead><tbody>{up.sample.slice(0, 10).map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j} className="small trunc">{c}</td>)}</tr>)}</tbody></table></div>
    </>}
  </Modal>;
}

function ExportModal({ lotId, sel, onClose }: { lotId: number; sel: number[]; onClose: () => void }) {
  const go = (u: string) => { window.open(u); onClose(); };
  const x = (scope: string) => `/api/lots/${lotId}/export.xlsx?scope=${scope}${scope === "selecionados" ? `&ids=${sel.join(",")}` : ""}`;
  return <Modal title="Exportar lote" onClose={onClose}>
    <div className="col">
      <div className="muted small">Excel completo com as abas: Dados originais, Pesquisa técnica, Compatibilidades, Mercado nacional, Mercado internacional, Concorrência indireta, Análise da IA, Dados validados, Histórico de alterações e Resumo financeiro por categoria. Links clicáveis e moedas originais preservados; todos os anúncios por SKU.</div>
      <div className="row wrap">
        <button className="btn primary" onClick={() => go(x("completo"))}>Excel — lote completo</button>
        <button className="btn" onClick={() => go(x("aprovados"))}>Excel — preços aprovados</button>
        <button className="btn" onClick={() => go(x("pendentes"))}>Excel — pendentes</button>
        <button className="btn" disabled={!sel.length} onClick={() => go(x("selecionados"))}>Excel — selecionados ({sel.length})</button>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => go(`/api/lots/${lotId}/export.csv`)}>CSV financeiro — lote</button>
        <button className="btn" onClick={() => go(`/api/lots/${lotId}/export.csv?scope=aprovados`)}>CSV — aprovados</button>
        <button className="btn" disabled={!sel.length} onClick={() => go(`/api/lots/${lotId}/export.csv?ids=${sel.join(",")}`)}>CSV — selecionados</button>
      </div>
    </div>
  </Modal>;
}
