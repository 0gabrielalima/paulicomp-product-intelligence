import { useEffect, useState } from "react";
import { useApi, num, dt, Badge } from "../ui.tsx";

export function Products({ onOpen }: { onOpen: (productId: number, itemId?: number) => void }) {
  const [q, setQ] = useState(""), [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useApi<any[]>(`/products?q=${encodeURIComponent(dq)}`);
  return <div>
    <div className="toolbar"><input type="search" placeholder="SKU, FRU, nome ou nomenclatura" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 340 }} /><span className="muted small">{data ? `${num(data.length)} produto(s)` : ""} · base permanente: cada SKU tem um registro único vinculado a todos os lotes, pesquisas e validações.</span></div>
    <div className="tablewrap" style={{ maxHeight: "calc(100vh - 150px)" }}><table className="t"><thead><tr><th>SKU</th><th>Nome comercial validado</th><th>Nomenclatura Lenovo</th><th>Commodity</th><th>FRU</th><th className="num">Lotes</th><th className="num">Unidades (total)</th><th>Validação técnica</th><th>Última pesquisa</th></tr></thead>
      <tbody>{(data || []).map((p) => <tr key={p.id} className="click" onClick={() => onOpen(p.id, p.last_item_id)}>
        <td className="mono">{p.sku}</td><td>{p.name || <span className="faint">—</span>}</td><td className="small trunc">{p.description}</td><td className="small">{p.commodity}</td><td className="mono small">{p.fru || "—"}</td>
        <td className="num">{p.lots}</td><td className="num">{num(p.units)}</td><td><Badge s={p.tech_status || "pendente"} /></td><td className="small">{dt(p.last_research)}</td></tr>)}</tbody></table></div>
  </div>;
}
