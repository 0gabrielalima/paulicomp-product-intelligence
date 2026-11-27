import { useMemo, useState } from "react";
import { useApi, money, num, Badge } from "../ui.tsx";

export function Validations({ onOpen }: { onOpen: (productId: number, itemId?: number) => void }) {
  const { data } = useApi<any[]>("/validation-queue");
  const [f, setF] = useState("pesquisados");
  const rows = useMemo(() => (data || []).filter((i) =>
    f === "todos" ? true : f === "pesquisados" ? i.research_status !== "nao_pesquisado" : f === "revisao" ? i.tech_status === "revisao_solicitada" || i.com_status === "revisao_solicitada" : f === "rascunho" ? i.tech_status === "rascunho" || i.com_status === "rascunho" : f === "sem_preco" ? i.approved_price == null && i.tech_status === "aprovada" : true)
    .sort((a, b) => (b.total_ai ?? 0) - (a.total_ai ?? 0) || b.quantity - a.quantity), [data, f]);
  return <div>
    <div className="toolbar">
      <select value={f} onChange={(e) => setF(e.target.value)}><option value="pesquisados">Pesquisados aguardando validação</option><option value="revisao">Revisão solicitada</option><option value="rascunho">Com rascunho</option><option value="sem_preco">Técnica aprovada, sem preço</option><option value="todos">Todos os pendentes</option></select>
      <span className="muted small">{num(rows.length)} item(ns) · ordenados por representatividade financeira</span>
    </div>
    <div className="tablewrap" style={{ maxHeight: "calc(100vh - 150px)" }}><table className="t"><thead><tr><th>Produto</th><th>Lote</th><th className="num">Qtd</th><th className="num">Preço IA</th><th className="num">Total IA</th><th>Pesquisa</th><th>Técnica</th><th>Comercial</th><th>Conf. técnica</th><th>Conf. comercial</th></tr></thead>
      <tbody>{rows.map((i) => <tr key={i.id} className="click" onClick={() => onOpen(i.product_id, i.id)}>
        <td className="namecell"><div className="n">{i.name || <span className="faint">Não identificado</span>}</div><div className="s mono">{i.sku} · {i.original_description}</div></td><td>{i.lot_code}</td><td className="num">{num(i.quantity)}</td>
        <td className="num">{money(i.ai_price)}</td><td className="num">{money(i.total_ai)}</td><td><Badge s={i.research_status} /></td><td><Badge s={i.tech_status} /></td><td><Badge s={i.approved_price != null ? "aprovada" : i.com_status} /></td><td><Badge s={i.conf_tech} /></td><td><Badge s={i.conf_com} /></td></tr>)}
        {!rows.length && <tr><td colSpan={10} className="empty">Nada pendente neste filtro.</td></tr>}</tbody></table></div>
  </div>;
}
