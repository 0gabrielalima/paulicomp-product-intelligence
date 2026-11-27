import { useState } from "react";
import { useApi, money, num, pct, Bars, Kpi, statusLabel } from "../ui.tsx";

export function Dashboard() {
  const [f, setF] = useState<any>({});
  const { data: lots } = useApi<any[]>("/lots");
  const { data: users } = useApi<any[]>("/users");
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const { data, error } = useApi<any>(`/dashboard?${qs}`);
  const { data: cats } = useApi<any>("/categories");
  if (error) return <div className="note">{error}</div>;
  const k = data?.kpis, c = data?.charts;
  return <div>
    <div className="toolbar">
      <select value={f.lot_id || ""} onChange={(e) => setF({ ...f, lot_id: e.target.value })}><option value="">Todos os lotes</option>{(lots || []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
      <label className="row small">De <input type="date" value={f.from || ""} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
      <label className="row small">Até <input type="date" value={f.to || ""} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      <select value={f.category || ""} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Todas as categorias</option>{(cats?.categories || []).map((x: any) => <option key={x.id}>{x.name}</option>)}</select>
      {users && <select value={f.user_id || ""} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">Todos os responsáveis</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
    </div>
    {!k ? <div className="empty">Carregando…</div> : <>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <Kpi l="Potencial validado" v={money(k.potencial_validado)} main />
        <Kpi l="Lotes" v={num(k.lotes)} /><Kpi l="SKUs recebidos" v={num(k.skus_recebidos)} /><Kpi l="SKUs únicos" v={num(k.skus_unicos)} /><Kpi l="Já existentes na base" v={num(k.ja_na_base)} />
        <Kpi l="Aguardando pesquisa" v={num(k.aguardando_pesquisa)} /><Kpi l="Pesquisas em andamento" v={num(k.em_andamento)} /><Kpi l="Pesquisas concluídas" v={num(k.concluidas)} />
        <Kpi l="Parcialmente concluídas" v={num(k.parciais)} title="Alguma fonte obrigatória não foi consultada" /><Kpi l="Pesquisas com falha" v={num(k.falhas)} />
        <Kpi l="Aguardando validação" v={num(k.aguardando_validacao)} /><Kpi l="Produtos aprovados" v={num(k.aprovados)} /><Kpi l="Não identificados" v={num(k.nao_identificados)} />
        <Kpi l="Sem concorrência nacional" v={num(k.sem_concorrencia_nacional)} /><Kpi l="Conclusão dos lotes" v={pct(k.pct_conclusao)} />
        <Kpi l="Custo acumulado" v={`US$ ${k.custo_acumulado_usd.toFixed(2)}`} title={`Mês atual: US$ ${k.custo_mes_usd.toFixed(2)}`} />
        <Kpi l="Tempo médio de pesquisa" v={k.tempo_medio_pesquisa_s != null ? `${k.tempo_medio_pesquisa_s} s` : "—"} />
      </div>
      <div className="grid3">
        <div className="card"><h3>Produtos por categoria</h3><div className="body"><Bars data={c.por_categoria} /></div></div>
        <div className="card"><h3>Status das pesquisas</h3><div className="body"><Bars data={c.status_pesquisa} labelFmt={statusLabel} /></div></div>
        <div className="card"><h3>Evolução das pesquisas</h3><div className="body">{c.evolucao.length ? <table className="t"><thead><tr><th>Dia</th><th className="num">Criadas</th><th className="num">Concluídas*</th><th className="num">Tempo médio</th></tr></thead><tbody>{c.evolucao.map((e: any) => <tr key={e.dia}><td>{new Date(e.dia + "T12:00").toLocaleDateString("pt-BR")}</td><td className="num">{e.criadas}</td><td className="num">{e.concluidas}</td><td className="num">{e.tempo_medio_s != null ? `${e.tempo_medio_s} s` : "—"}</td></tr>)}</tbody></table> : <div className="faint small">Nenhuma pesquisa ainda</div>}<div className="faint small">* concluídas + parciais</div></div></div>
        <div className="card"><h3>Validação técnica</h3><div className="body"><Bars data={c.status_validacao_tecnica} labelFmt={statusLabel} /></div></div>
        <div className="card"><h3>Validação comercial</h3><div className="body"><Bars data={c.status_validacao_comercial} labelFmt={statusLabel} /></div></div>
        <div className="card"><h3>Níveis de confiança</h3><div className="body"><div className="small muted">Técnica</div><Bars data={c.confianca_tecnica} labelFmt={statusLabel} /><div className="small muted" style={{ marginTop: 8 }}>Comercial</div><Bars data={c.confianca_comercial} labelFmt={statusLabel} /></div></div>
        <div className="card"><h3>Aproveitamento da base</h3><div className="body"><Bars data={{ "Já existentes na base": c.aproveitamento_base.ja_existentes, "Novos SKUs": c.aproveitamento_base.novos }} /></div></div>
      </div>
    </>}
  </div>;
}
