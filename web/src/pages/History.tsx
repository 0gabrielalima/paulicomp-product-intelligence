import { useState } from "react";
import { useApi, dt } from "../ui.tsx";

export function History() {
  const [f, setF] = useState<any>({});
  const { data: lots } = useApi<any[]>("/lots");
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const { data } = useApi<any[]>(`/history?${qs}`);
  return <div>
    <div className="toolbar">
      <select value={f.lot_id || ""} onChange={(e) => setF({ ...f, lot_id: e.target.value })}><option value="">Todos os lotes</option>{(lots || []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
      <input placeholder="Filtrar ação (ex.: preco, validacao, anuncio)" value={f.action || ""} onChange={(e) => setF({ ...f, action: e.target.value })} />
      <span className="muted small">Registro imutável de alterações: usuário, data, valor anterior, valor novo e motivo.</span>
    </div>
    <div className="tablewrap" style={{ maxHeight: "calc(100vh - 150px)" }}><table className="t"><thead><tr><th>Quando</th><th>Usuário</th><th>Lote</th><th>SKU</th><th>Ação</th><th>Campo</th><th>Anterior</th><th>Novo</th><th>Motivo</th></tr></thead>
      <tbody>{(data || []).map((h) => <tr key={h.id}><td className="small">{dt(h.created_at)}</td><td>{h.user_name || "sistema"}</td><td>{h.lot_code || ""}</td><td className="mono small">{h.sku || ""}</td><td className="small">{h.action.replace(/_/g, " ")}</td><td className="small">{h.field}</td>
        <td className="small mono trunc" style={{ maxWidth: 220 }} title={JSON.stringify(h.old_value)}>{h.old_value == null ? "" : JSON.stringify(h.old_value)}</td>
        <td className="small mono trunc" style={{ maxWidth: 260 }} title={JSON.stringify(h.new_value)}>{h.new_value == null ? "" : JSON.stringify(h.new_value)}</td><td className="small">{h.reason}</td></tr>)}</tbody></table></div>
  </div>;
}
