import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ---------- API ----------
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/me" && path !== "/auth/login") window.dispatchEvent(new Event("ppi:logout"));
  if (!res.ok) throw new Error(j.error || `Erro ${res.status}`);
  return j as T;
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path).then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [path, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

// ---------- Sessao ----------
export type User = { id: number; name: string; email: string; roles: string[] };
export const UserCtx = createContext<User | null>(null);
export const useUser = () => useContext(UserCtx)!;
export const can = (u: User | null, ...roles: string[]) => !!u && (u.roles.includes("admin") || roles.some((r) => u.roles.includes(r)));

// ---------- Toast ----------
let pushToast: (m: string, error?: boolean) => void = () => {};
export const toast = (m: string, error = false) => pushToast(m, error);
export function Toaster() {
  const [t, setT] = useState<{ m: string; e: boolean } | null>(null);
  useEffect(() => { pushToast = (m, e = false) => { setT({ m, e }); setTimeout(() => setT(null), e ? 6000 : 2800); }; }, []);
  return t ? <div className={`toast ${t.e ? "error" : ""}`}>{t.m}</div> : null;
}

// ---------- Formatacao ----------
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");
export const money = (v: number | null | undefined) => (v == null ? "—" : brl.format(v));
export const fmtCur = (v: number | null | undefined, cur: string) => {
  if (v == null) return "—";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(v); } catch { return `${cur} ${v}`; }
};
export const num = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const dateOnly = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString("pt-BR") : "—");

// ---------- Status (cores consistentes: verde ok, amarelo atencao, vermelho falha, azul processando, cinza pendente) ----------
const S: Record<string, [string, string]> = {
  // pesquisa
  nao_pesquisado: ["Não pesquisado", "gray"], na_fila: ["Na fila", "blue"], em_andamento: ["Em andamento", "blue"], pausada: ["Pausada", "yellow"],
  concluida: ["Concluída", "green"], parcial: ["Parcial", "yellow"], falha: ["Falha", "red"], cancelada: ["Cancelada", "gray"],
  // etapas
  pendente: ["Pendente", "gray"], executando: ["Executando", "blue"], ignorada: ["Ignorada", "gray"], nao_configurada: ["Não configurada", "gray"],
  aguardando_manual: ["Aguardando ação manual", "yellow"], bloqueada: ["Bloqueio de consulta", "red"],
  // validacao
  rascunho: ["Rascunho", "yellow"], aprovada: ["Aprovada", "green"], aprovado: ["Aprovado", "green"], revisao_solicitada: ["Revisão solicitada", "yellow"], nao_identificado: ["Não identificado", "red"],
  // confianca
  alta: ["Alta", "green"], media: ["Média", "yellow"], baixa: ["Baixa", "red"], insuficiente: ["Insuficiente", "gray"],
  // jobs
  queued: ["Na fila", "blue"], running: ["Executando", "blue"], done: ["Finalizada", "green"], failed: ["Falha", "red"], paused: ["Pausada", "yellow"], cancelled: ["Cancelada", "gray"],
  // integracoes
  ativa: ["Ativa", "green"], semiautomatica: ["Semiautomática", "yellow"],
};
export const statusLabel = (s: string) => S[s]?.[0] || s?.replace(/_/g, " ") || "—";
export function Badge({ s, title, prefix }: { s: string; title?: string; prefix?: string }) {
  const [label, color] = S[s] || [s?.replace(/_/g, " ") || "—", "gray"];
  return <span className={`b ${color}`} title={title}>{prefix}{label}</span>;
}

export const LABELS: Record<string, Record<string, string>> = {
  condition: { nova: "Nova", usada: "Usada", recondicionada: "Recondicionada", retirada_equipamento: "Retirada de equipamento", nao_informada: "Não informada" },
  originality: { original_confirmada: "Original confirmada", anunciada_original: "Anunciada como original", paralela: "Paralela", nao_confirmada: "Não confirmada" },
  commercial_version: { oem: "OEM", tray: "TRAY", box: "BOX", retail: "Retail", nao_identificada: "Não identificada" },
  availability: { disponivel: "Disponível para compra", sob_encomenda: "Sob encomenda", estoque_nao_confirmado: "Estoque não confirmado", indisponivel: "Indisponível", esgotado: "Esgotado", vendido: "Vendido", encerrado: "Encerrado", inacessivel: "Página inacessível", bloqueio: "Bloqueio de consulta" },
  match_type: { sku_exato: "Correspondência exata de SKU", codigo_equivalente_oficial: "Código equivalente oficial", mesmo_modelo: "Mesmo modelo comercial", equivalencia_nao_confirmada: "Possível equivalência não confirmada", tecnicamente_semelhante: "Tecnicamente semelhante", substituto_comercial: "Substituto comercial", incompativel: "Incompatível" },
  compat: { oficial_sku: "Confirmada oficialmente para o SKU", oficial_modelo: "Confirmada para o modelo comercial", tecnica_generica: "Compatibilidade técnica genérica", fonte_complementar: "Fonte complementar", necessita_validacao: "Necessita validação" },
  confirmation: { oficial: "Oficial", fonte_complementar: "Fonte complementar", hipotese: "Hipótese (não confirmada)" },
  price_origin: { pagina: "Página do anúncio", indexado: "Resultado indexado", manual: "Inserido manualmente" },
};
export const lab = (group: string, v: string | null | undefined) => (v ? LABELS[group]?.[v] || v : "—");
export function Select({ group, value, onChange, empty }: { group: string; value: string; onChange: (v: string) => void; empty?: string }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{empty !== undefined && <option value="">{empty}</option>}{Object.entries(LABELS[group]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>;
}

// ---------- Componentes ----------
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal" style={wide ? { width: "min(1250px, 96vw)" } : undefined}>
      <div className="mh"><h3>{title}</h3><button className="iconbtn right" onClick={onClose} title="Fechar (Esc)">✕</button></div>
      <div className="mb">{children}</div>
      {footer && <div className="mf">{footer}</div>}
    </div>
  </div>;
}

export function Bars({ data, fmt = num, labelFmt = (k: string) => k }: { data: Record<string, number>; fmt?: (v: number) => string; labelFmt?: (k: string) => string }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (!entries.length) return <div className="faint small">Sem dados</div>;
  return <div className="bars">{entries.map(([k, v]) => <div className="r" key={k}><span className="trunc" title={labelFmt(k)}>{labelFmt(k)}</span><div className="track"><div className="fill" style={{ width: `${(v / max) * 100}%` }} /></div><span className="num">{fmt(v)}</span></div>)}</div>;
}

export function Kpi({ l, v, main, title }: { l: string; v: ReactNode; main?: boolean; title?: string }) {
  return <div className={`kpi ${main ? "main" : ""}`} title={title}><div className="l">{l}</div><div className="v">{v}</div></div>;
}

export function copy(text: string, msg = "Copiado") { navigator.clipboard.writeText(text).then(() => toast(msg)); }
export function Ext({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children || "Abrir ↗"}</a>;
}
