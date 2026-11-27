import { useState } from "react";
import { api, useApi, money, num, pct, dateOnly, dt, Modal, toast, can, useUser } from "../ui.tsx";

export function Lots() {
  const user = useUser();
  const { data, reload } = useApi<any[]>("/lots");
  const [imp, setImp] = useState(false);
  return <div>
    <div className="toolbar">
      <span className="muted">{data ? `${data.length} lote(s)` : "Carregando…"}</span>
      {can(user, "pesquisador") && <button className="btn primary right" onClick={() => setImp(true)}>+ Importar lote</button>}
    </div>
    <div className="tablewrap"><table className="t"><thead><tr><th>Lote</th><th>Recebimento</th><th>Arquivo</th><th className="num">SKUs</th><th className="num">Unidades</th><th className="num">Pesquisados</th><th className="num">Validados</th><th className="num">Unid. c/ preço aprovado</th><th className="num">Potencial validado</th><th className="num">Sugerido IA</th><th>Importado</th></tr></thead>
      <tbody>{(data || []).map((l) => <tr key={l.id} className="click" onClick={() => (location.hash = `#/lotes/${l.id}`)}>
        <td><b>{l.code}</b></td><td>{dateOnly(l.received_at)}</td><td className="small trunc">{l.source_filename}</td><td className="num">{num(l.header.skus)}</td><td className="num">{num(l.header.units)}</td>
        <td className="num">{pct(l.header.pct_research)}</td><td className="num">{pct(l.header.pct_validation)}</td><td className="num">{pct(l.header.pct_units_approved)}</td>
        <td className="num"><b>{money(l.header.potential_validated)}</b></td><td className="num">{money(l.header.potential_ai)}</td><td className="small">{dt(l.created_at)} · {l.created_by_name}</td>
      </tr>)}
        {data && !data.length && <tr><td colSpan={11} className="empty">Nenhum lote importado. Clique em “Importar lote”.</td></tr>}</tbody></table></div>
    {imp && <ImportWizard onClose={() => setImp(false)} onDone={(id) => { setImp(false); reload(); location.hash = `#/lotes/${id}`; }} />}
  </div>;
}

const MAP_FIELDS: [string, string, boolean][] = [["sku", "SKU *", true], ["description", "Nomenclatura original Lenovo", false], ["quantity", "Quantidade", false], ["commodity", "Categoria / Commodity", false]];

function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [step, setStep] = useState(0);
  const [up, setUp] = useState<any>(null);
  const [pv, setPv] = useState<any>(null);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [sheet, setSheet] = useState(""), [hr, setHr] = useState(0);
  const [code, setCode] = useState(""), [received, setReceived] = useState(new Date().toISOString().slice(0, 10)), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyErr, setOnlyErr] = useState(false);

  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    setBusy(true);
    try { const r = await api("/import/upload", { form: fd }); setUp(r); setSheet(r.sheet); setHr(r.header_row); setMap(r.mapping); setCode(f.name.replace(/\.[^.]+$/, "").replace(/^Broker\s*-\s*/i, "")); setStep(1); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  async function preview(s = sheet, h = hr, m: any = map) {
    setBusy(true);
    try { const r = await api("/import/preview", { body: { token: up.token, sheet: s, header_row: h, mapping: m } }); setPv(r); setMap(r.mapping); setSheet(r.sheet); setHr(r.header_row); setStep(2); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true);
    try { const r = await api("/import/commit", { body: { token: up.token, sheet, header_row: hr, mapping: map, code, received_at: received, notes } }); toast("Lote importado"); onDone(r.lot_id); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  const s = pv?.stats;
  const footer = step === 0 ? undefined : <>
    <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>Voltar</button>
    {step === 1 && <button className="btn primary" onClick={() => preview()} disabled={busy || map.sku == null}>Validar dados →</button>}
    {step === 2 && <button className="btn primary" onClick={() => setStep(3)} disabled={busy}>Continuar →</button>}
    {step === 3 && <button className="btn ok" onClick={commit} disabled={busy || !code.trim()}>Confirmar importação</button>}
  </>;
  return <Modal title="Importar lote Lenovo" onClose={onClose} wide footer={footer}>
    <div className="steps">{["Arquivo", "Aba e colunas", "Verificação", "Confirmação"].map((t, i) => <span key={t} className={step === i ? "on" : ""}>{i + 1}. {t}</span>)}</div>
    {step === 0 && <div className="empty">
      <p>Selecione a planilha recebida da Lenovo (XLS, XLSX ou CSV). Os dados originais são preservados integralmente; SKUs são tratados como texto.</p>
      <label className="btn primary">{busy ? "Lendo…" : "Escolher arquivo"}<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
    </div>}
    {step === 1 && up && <div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <label className="f"><span>Aba</span><select value={sheet} onChange={(e) => { setSheet(e.target.value); preview(e.target.value, undefined as any, null).then(() => setStep(1)); }}>{up.sheets.map((x: any) => <option key={x.name} value={x.name}>{x.name} ({x.rows} linhas)</option>)}</select></label>
        <label className="f"><span>Linha do cabeçalho</span><input type="number" min={1} value={hr + 1} onChange={(e) => setHr(Math.max(0, Number(e.target.value) - 1))} style={{ width: 90 }} /></label>
        {MAP_FIELDS.map(([k, l]) => <label className="f" key={k}><span>{l}</span><select value={map[k] ?? ""} onChange={(e) => setMap({ ...map, [k]: e.target.value === "" ? null : Number(e.target.value) })}><option value="">— não importar —</option>{(pv?.headers || up.headers).map((h: string, i: number) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}</select></label>)}
      </div>
      <div className="muted small" style={{ marginBottom: 6 }}>Pré-visualização ({up.total_rows} linhas). Todas as colunas — mapeadas ou não — são guardadas como dados originais.</div>
      <div className="tablewrap" style={{ maxHeight: 380 }}><table className="t"><thead><tr>{(pv?.headers || up.headers).map((h: string, i: number) => <th key={i}>{h}{Object.entries(map).filter(([, v]) => v === i).map(([k]) => <span key={k} className="b blue" style={{ marginLeft: 4 }}>{MAP_FIELDS.find((f) => f[0] === k)?.[1].replace(" *", "")}</span>)}</th>)}</tr></thead>
        <tbody>{(pv?.sample || up.sample).map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j} className={`small ${map.sku === j ? "mono" : ""}`}>{c}</td>)}</tr>)}</tbody></table></div>
    </div>}
    {step === 2 && pv && <div>
      <div className="kpis" style={{ marginBottom: 10 }}>
        <div className="kpi"><div className="l">Linhas</div><div className="v">{num(s.linhas)}</div></div>
        <div className="kpi"><div className="l">SKUs únicos</div><div className="v">{num(s.skus_unicos)}</div></div>
        <div className="kpi"><div className="l">Unidades</div><div className="v">{num(s.unidades)}</div></div>
        <div className="kpi"><div className="l">Linhas com erro</div><div className="v" style={{ color: s.com_erro ? "var(--red)" : undefined }}>{num(s.com_erro)}</div></div>
        <div className="kpi"><div className="l">SKUs duplicados</div><div className="v">{num(s.duplicados.length)}</div></div>
        <div className="kpi"><div className="l">Já na base</div><div className="v">{num(s.ja_na_base)}</div></div>
        <div className="kpi"><div className="l">Já validados</div><div className="v">{num(s.ja_validados)}</div></div>
      </div>
      {s.duplicados.length > 0 && <div className="note" style={{ marginBottom: 8 }}>SKUs duplicados serão pesquisados uma única vez, com as quantidades somadas e vínculo mantido com cada linha original: {s.duplicados.map((x: any) => `${x.sku} (${x.n}×)`).join(", ")}</div>}
      {s.ja_na_base > 0 && <div className="note info" style={{ marginBottom: 8 }}>{s.ja_na_base} SKU(s) já existem na base. Os dados técnicos validados serão reaproveitados; depois da importação você escolhe quais pesquisar novamente.</div>}
      <label className="row small" style={{ marginBottom: 6 }}><input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} /> Mostrar somente linhas com observações</label>
      <div className="tablewrap" style={{ maxHeight: 340 }}><table className="t"><thead><tr><th>Linha</th><th>SKU</th><th>Nomenclatura</th><th>Commodity</th><th className="num">Qtd</th><th>Observações</th></tr></thead>
        <tbody>{pv.rows.filter((r: any) => !onlyErr || r.issues.length).map((r: any) => <tr key={r.row_number}><td>{r.row_number}</td><td className="mono">{r.sku || <span className="err">vazio</span>}</td><td className="small">{r.description}</td><td className="small">{r.commodity}</td><td className="num">{num(r.quantity)}</td>
          <td className="small">{r.issues.map((x: string) => <span key={x} className={`b ${x.startsWith("SKU duplicado") ? "yellow" : "red"}`}>{x}</span>)}{pv.known.find((k: any) => k.sku === r.sku) && <span className="b blue">já na base</span>}</td></tr>)}</tbody></table></div>
    </div>}
    {step === 3 && <div className="grid2">
      <label className="f"><span>Nome ou código do lote *</span><input value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
      <label className="f"><span>Data de recebimento</span><input type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
      <label className="f" style={{ gridColumn: "1 / -1" }}><span>Observações</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="note info" style={{ gridColumn: "1 / -1" }}>Serão importadas {num(s?.linhas)} linhas, {num(s?.skus_unicos)} SKUs únicos e {num(s?.unidades)} unidades do arquivo <b>{up?.filename}</b> (aba {sheet}). Linhas sem SKU são preservadas nos dados originais, mas não geram produto.</div>
    </div>}
  </Modal>;
}
