import { Fragment, useEffect, useState } from "react";
import { api, useApi, dt, Badge, Modal, toast, can, useUser, num } from "../ui.tsx";
import { StepList } from "./ProductPanel.tsx";

export function Research({ onOpen }: { onOpen: (productId: number) => void }) {
  const user = useUser();
  const [status, setStatus] = useState("");
  const { data, reload } = useApi<any>(`/research/runs${status ? `?status=${status}` : ""}`);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setInterval(reload, 4000); return () => clearInterval(t); }, [status]);
  async function act(id: number, action: string) { try { await api(`/research/runs/${id}/${action}`, { method: "POST" }); toast("Ok"); reload(); } catch (e: any) { toast(e.message, true); } }
  async function queue(action: string) { try { await api(`/queue/${action}`, { method: "POST" }); reload(); } catch (e: any) { toast(e.message, true); } }
  const q = data?.queue || {};
  const dur = (r: any) => r.started_at && r.finished_at ? `${Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)} s` : "—";
  return <div>
    <div className="kpis" style={{ marginBottom: 10 }}>
      {[["Na fila", q.queued], ["Executando", q.running], ["Pausadas", q.paused], ["Finalizadas", q.done], ["Com falha", q.failed], ["Canceladas", q.cancelled]].map(([l, v]) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v">{num(v || 0)}</div></div>)}
    </div>
    <div className="toolbar">
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos os status</option>{["na_fila", "em_andamento", "pausada", "concluida", "parcial", "falha", "cancelada"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
      <span className="small muted">Atualiza a cada 4 s. O processamento acontece no servidor — pode fechar o navegador.</span>
      {can(user, "admin") && <><button className="btn right" onClick={() => queue("pause_all")}>Pausar fila</button><button className="btn" onClick={() => queue("resume_all")}>Retomar fila</button></>}
    </div>
    <div className="tablewrap"><table className="t"><thead><tr><th>#</th><th>SKU</th><th>Lote</th><th>Tipo</th><th>Status</th><th>Etapas</th><th>Início</th><th>Conclusão</th><th>Duração</th><th className="num">Tentativas</th><th className="num">Custo US$</th><th>Resumo / erro</th><th></th></tr></thead>
      <tbody>{(data?.runs || []).map((r: any) => { const st = r.steps || []; const ok = st.filter((s: any) => s.status === "concluida").length; return <Fragment key={r.id}>
        <tr>
          <td>{r.id}</td><td><a href="#" onClick={(e) => { e.preventDefault(); onOpen(r.product_id); }} className="mono">{r.sku}</a></td><td>{r.lot_code || "—"}</td><td>{r.kind}</td><td><Badge s={r.status} /></td>
          <td className="small">{ok}/{st.length} concluídas</td><td className="small">{dt(r.started_at)}</td><td className="small">{dt(r.finished_at)}</td><td className="small">{dur(r)}</td><td className="num">{r.job_attempts ?? "—"}</td><td className="num">{Number(r.cost_usd).toFixed(3)}</td>
          <td className="small trunc" style={{ maxWidth: 360 }} title={r.summary || r.job_error}>{r.job_error || r.summary}</td>
          <td><div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>Execução</button>
            {can(user, "pesquisador") && ["queued", "running"].includes(r.job_status) && <button className="btn sm" onClick={() => act(r.id, "pause")}>Pausar</button>}
            {can(user, "pesquisador") && r.job_status === "paused" && <button className="btn sm" onClick={() => act(r.id, "resume")}>Retomar</button>}
            {can(user, "pesquisador") && ["queued", "running", "paused"].includes(r.job_status) && <button className="btn sm danger" onClick={() => act(r.id, "cancel")}>Cancelar</button>}
            {can(user, "pesquisador") && ["parcial", "falha", "cancelada"].includes(r.status) && !["queued", "running", "paused"].includes(r.job_status) && <button className="btn sm" onClick={() => act(r.id, "retry_failed")} title="Repete apenas as etapas não concluídas">Repetir etapas pendentes</button>}
          </div></td>
        </tr>
        {open === r.id && <tr><td colSpan={13} style={{ background: "var(--surface-2)" }}><StepList steps={st} labels={data.step_labels} /></td></tr>}
      </Fragment>; })}
        {data && !data.runs.length && <tr><td colSpan={13} className="empty">Nenhuma pesquisa registrada.</td></tr>}</tbody></table></div>
  </div>;
}

/** Disparo de pesquisa com estimativa de custo antes da execucao. */
export function ResearchModal({ lotId, itemIds, onClose }: { lotId: number; itemIds?: number[]; onClose: () => void }) {
  const [kind, setKind] = useState("completa");
  const [filter, setFilter] = useState(itemIds ? "" : "nao_pesquisados");
  const [est, setEst] = useState<any>(null);
  const body = { lot_id: lotId, item_ids: itemIds, filter: filter || undefined, kind };
  useEffect(() => { api("/research/estimate", { body }).then(setEst).catch((e) => toast(e.message, true)); }, [kind, filter]);
  async function go() { try { const r = await api("/research/start", { body }); toast(`${r.created} pesquisa(s) na fila${r.skipped ? `, ${r.skipped} já ativas` : ""}`); onClose(); } catch (e: any) { toast(e.message, true); } }
  return <Modal title={itemIds ? `Pesquisar ${itemIds.length} produto(s) selecionado(s)` : "Pesquisar produtos do lote"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={go} disabled={!est?.produtos}>Enviar {est?.produtos ?? ""} para a fila</button></>}>
    <div className="grid2">
      <label className="f"><span>Tipo de pesquisa</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="completa">Completa (técnica + mercado + IA)</option><option value="precos">Atualizar somente preços</option><option value="tecnica">Atualizar somente dados técnicos</option><option value="ia">Somente nova análise da IA</option></select></label>
      <label className="f"><span>Quais produtos</span><select value={filter} onChange={(e) => setFilter(e.target.value)}>
        {itemIds && <option value="">Selecionados</option>}
        <option value="todos">{itemIds ? "Selecionados (todos)" : "Lote completo"}</option><option value="nao_pesquisados">Ainda não pesquisados</option><option value="nao_identificados">Não identificados</option>
        <option value="falhas">Com falha ou parciais</option><option value="precos_desatualizados">Preços desatualizados (validade comercial)</option><option value="baixa_confianca">Baixa confiança</option></select></label>
    </div>
    {est && <div className="note info" style={{ marginTop: 12 }}>
      <b>{est.produtos} produto(s)</b> · estimativa de {est.buscas_por_sku} buscas web e ~US$ {est.custo_estimado_por_sku_usd} por SKU · total estimado <b>US$ {est.custo_estimado_total_usd}</b> ({est.modelo}).
      <div className="small" style={{ marginTop: 4 }}>{est.observacao}</div>
      {!est.ia_configurada && <div className="small" style={{ marginTop: 4 }}><b>IA não configurada:</b> nesta execução só rodam a verificação da base, a checagem da consulta Lenovo e o câmbio PTAX (custo zero). As demais etapas ficam “não configurada” e a pesquisa aparece como parcial — nunca como concluída.</div>}
    </div>}
  </Modal>;
}
