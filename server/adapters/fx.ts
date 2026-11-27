// Cotacao oficial PTAX do Banco Central do Brasil (API publica Olinda, sem credencial).
import { db, one } from "../db.ts";

const BASE = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";
const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

export type FxQuote = { id: number; currency: string; rate: number; source: string; quoted_at: string };

/** Busca a cotacao PTAX de venda mais recente (ultimos 10 dias) e grava. BRL retorna 1. */
export async function fetchPtax(currency: string): Promise<FxQuote> {
  const cur = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`Moeda não identificada: "${currency}"`);
  if (cur === "BRL") return { id: 0, currency: "BRL", rate: 1, source: "—", quoted_at: new Date().toISOString() };
  const end = new Date(), start = new Date(Date.now() - 10 * 86400_000);
  const url = `${BASE}/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${cur}'&@dataInicial='${fmt(start)}'&@dataFinalCotacao='${fmt(end)}'&$format=json&$orderby=dataHoraCotacao%20desc&$top=10`;
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
  catch (e: any) { throw new Error(`BCB PTAX inacessível: ${e?.cause?.code || e?.cause?.message || e?.message}`); }
  if (!res.ok) throw new Error(`BCB PTAX respondeu HTTP ${res.status}`);
  const j: any = await res.json();
  const vals: any[] = j.value || [];
  if (!vals.length) throw new Error(`Sem cotação PTAX para ${cur} nos últimos 10 dias (moeda pode não ser coberta pela PTAX).`);
  const q = vals.find((v) => v.tipoBoletim === "Fechamento") || vals[0];
  const row = await one(db, `INSERT INTO fx_quotes(currency,rate,source,quoted_at,raw) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [cur, q.cotacaoVenda, `BCB PTAX venda (${q.tipoBoletim})`, new Date(q.dataHoraCotacao.replace(" ", "T") + "-03:00").toISOString(), JSON.stringify(q)]);
  return row as FxQuote;
}

export async function latestQuote(currency: string) {
  return one<FxQuote & Record<string, any>>(db, "SELECT * FROM fx_quotes WHERE currency=$1 ORDER BY fetched_at DESC LIMIT 1", [currency.toUpperCase()]);
}

/** Conversao deterministica; o valor convertido e gravado no anuncio e nao muda depois. */
export const convert = (amount: number, rate: number) => Math.round(amount * rate * 100) / 100;
