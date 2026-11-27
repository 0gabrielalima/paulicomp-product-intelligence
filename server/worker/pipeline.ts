// Motor de pesquisa em etapas. Cada etapa e independente: a falha de uma fonte nao impede as demais.
import { db, one, getSetting } from "../db.ts";
import { fetchPtax } from "../adapters/fx.ts";
import { search, consolidate } from "../adapters/gemini.ts";

export type StepDef = { step: string; source: string; label: string; required: boolean; kinds: string[] };

export const STEPS: StepDef[] = [
  { step: "base_interna", source: "Base Paulicomp", label: "Verificação da base interna", required: true, kinds: ["completa", "precos", "tecnica"] },
  { step: "lenovo_parts_lookup", source: "Lenovo Parts Lookup", label: "Consulta oficial Lenovo", required: true, kinds: ["completa", "tecnica"] },
  { step: "psref", source: "Lenovo PSREF", label: "Pesquisa complementar oficial (PSREF/fabricantes)", required: false, kinds: ["completa", "tecnica"] },
  { step: "busca_sku", source: "Pesquisa web", label: "Pesquisa pelo SKU exato", required: true, kinds: ["completa", "tecnica"] },
  { step: "nomenclatura", source: "IA", label: "Interpretação da nomenclatura", required: true, kinds: ["completa", "tecnica"] },
  { step: "busca_expandida", source: "Pesquisa web", label: "Pesquisa expandida (modelo, PN, FRUs)", required: false, kinds: ["completa", "tecnica"] },
  { step: "mercado_nacional", source: "Mercado Livre + web", label: "Mercado nacional", required: true, kinds: ["completa", "precos"] },
  { step: "cambio", source: "BCB PTAX", label: "Cotação cambial", required: true, kinds: ["completa", "precos"] },
  { step: "mercado_internacional", source: "eBay + web", label: "Mercado internacional", required: true, kinds: ["completa", "precos"] },
  { step: "concorrencia_indireta", source: "Pesquisa web", label: "Concorrência indireta", required: false, kinds: ["completa", "precos"] },
  { step: "consolidacao_ia", source: "IA", label: "Consolidação e sugestão de preço", required: true, kinds: ["completa", "precos", "tecnica", "ia"] },
];

type Ctx = { runId: number; stepId: number; productId: number; sku: string; log: (msg: string, data?: unknown) => Promise<void> };
type Outcome = { status: string; error?: string };

const notConfigured = (what: string): Outcome => ({ status: "nao_configurada", error: `Integração não configurada: ${what}. Nenhum dado foi inventado; a etapa será executada quando a credencial existir.` });

const HANDLERS: Record<string, (c: Ctx) => Promise<Outcome>> = {
  async base_interna(c) {
    const tv = await one(db, "SELECT status, created_at FROM tech_validations WHERE product_id=$1 ORDER BY version DESC LIMIT 1", [c.productId]);
    const prev = await one(db, "SELECT count(*)::int AS n, max(finished_at) AS last FROM research_runs WHERE product_id=$1 AND id<>$2 AND status IN ('concluida','parcial')", [c.productId, c.runId]);
    const codes = await db.query("SELECT code, code_type, confirmation FROM product_codes WHERE product_id=$1", [c.productId]);
    const mk = await one(db, "SELECT max(collected_at) AS last, count(*)::int AS n FROM listings WHERE product_id=$1", [c.productId]);
    const val = await getSetting<any>("validade");
    const stale = mk?.last && val?.comercial_dias ? (Date.now() - new Date(mk.last).getTime()) / 86400_000 > val.comercial_dias : null;
    await c.log("Base interna verificada", {
      validacao_tecnica: tv ? `${tv.status} em ${new Date(tv.created_at).toLocaleString("pt-BR")}` : "nenhuma",
      pesquisas_anteriores: prev?.n || 0, ultima_pesquisa: prev?.last || null,
      codigos_conhecidos: codes.length, anuncios_registrados: mk?.n || 0, ultima_pesquisa_mercado: mk?.last || null,
      mercado_desatualizado: stale,
    });
    return { status: "concluida" };
  },
  async lenovo_parts_lookup(c) {
    const s = await one(db, "SELECT fetched_at, reference FROM sources WHERE product_id=$1 AND source_type='lenovo_parts_lookup' ORDER BY fetched_at DESC LIMIT 1", [c.productId]);
    if (s) { await c.log("Resultado oficial Lenovo já registrado", { consultado_em: s.fetched_at, referencia: s.reference }); return { status: "concluida" }; }
    await c.log("Aguardando consulta semiautomática: cole o SKU no Parts Lookup (bloco do lote) e importe/registre o resultado.");
    return { status: "aguardando_manual", error: "Consulta Lenovo pendente (fluxo semiautomático)." };
  },
  async psref(c) { return search(c, "psref"); },
  async busca_sku(c) { return search(c, "busca_sku"); },
  async nomenclatura(c) { await c.log("Nomenclatura original utilizada na expansão da pesquisa"); return {status:"concluida"}; },
  async busca_expandida(c) { return search(c, "busca_expandida"); },
  async mercado_nacional(c) { return search(c, "mercado_nacional"); },
  async cambio(c) {
    const out: Record<string, unknown> = {};
    let fails = 0;
    for (const cur of ["USD", "EUR"]) {
      try {
        // reaproveita cotacao obtida na ultima hora (pesquisa em massa nao repete 300 consultas ao BCB)
        const q = (await one<any>(db, "SELECT * FROM fx_quotes WHERE currency=$1 AND fetched_at > now() - interval '1 hour' ORDER BY fetched_at DESC LIMIT 1", [cur])) || await fetchPtax(cur);
        out[cur] = { taxa: q.rate, fonte: q.source, cotacao_em: q.quoted_at }; }
      catch (e: any) { fails++; out[cur] = { erro: e.message }; }
    }
    await c.log("Cotações PTAX obtidas", out);
    return fails === 2 ? { status: "falha", error: "BCB PTAX indisponível" } : fails ? { status: "parcial" } : { status: "concluida" };
  },
  async mercado_internacional(c) { return search(c, "mercado_internacional"); },
  async concorrencia_indireta(c) { return search(c, "concorrencia_indireta"); },
  async consolidacao_ia(c) { return consolidate(c); },
};

export async function createRun(productId: number, kind: string, userId: number | null, lotId: number | null) {
  const run = await one(db, "INSERT INTO research_runs(product_id,lot_id,kind,requested_by) VALUES($1,$2,$3,$4) RETURNING *", [productId, lotId, kind, userId]);
  let seq = 0;
  for (const s of STEPS.filter((s) => s.kinds.includes(kind)))
    await db.query("INSERT INTO research_steps(run_id,seq,step,source,required) VALUES($1,$2,$3,$4,$5)", [run!.id, ++seq, s.step, s.source, s.required]);
  return run!;
}

/** Executa as etapas pendentes (ou somente as informadas). Verifica pausa/cancelamento entre etapas. */
export async function executeRun(runId: number, jobId: number, onlySteps?: string[]) {
  const run = await one(db, "SELECT r.*, p.sku FROM research_runs r JOIN products p ON p.id=r.product_id WHERE r.id=$1", [runId]);
  if (!run) throw new Error(`Pesquisa ${runId} não encontrada`);
  await db.query("UPDATE research_runs SET status='em_andamento', started_at=COALESCE(started_at, now()) WHERE id=$1", [runId]);
  const steps = await db.query("SELECT * FROM research_steps WHERE run_id=$1 ORDER BY seq", [runId]);
  for (const s of steps) {
    if (onlySteps ? !onlySteps.includes(s.step) : ["concluida", "ignorada"].includes(s.status)) continue;
    const j = await one(db, "SELECT status FROM jobs WHERE id=$1", [jobId]);
    if (j?.status === "cancelled") { await finalizeRun(runId, "cancelada"); return "cancelled"; }
    if (j?.status === "paused") { await db.query("UPDATE research_runs SET status='pausada' WHERE id=$1", [runId]); return "paused"; }
    await db.query("UPDATE research_steps SET status='executando', started_at=now(), attempts=attempts+1, error=NULL WHERE id=$1", [s.id]);
    const log = async (msg: string, data?: unknown) => {
      await db.query("UPDATE research_steps SET log = log || $2::jsonb WHERE id=$1", [s.id, JSON.stringify([{ at: new Date().toISOString(), msg, data: data ?? null }])]);
    };
    let out: Outcome;
    try { out = await HANDLERS[s.step]({ runId, stepId: s.id, productId: run.product_id, sku: run.sku, log }); }
    catch (e: any) { out = { status: "falha", error: e?.message || String(e) }; await log("Erro", { erro: out.error }); }
    await db.query("UPDATE research_steps SET status=$2, error=$3, finished_at=now() WHERE id=$1", [s.id, out.status, out.error ?? null]);
  }
  await finalizeRun(runId);
  return "done";
}

/** Concluida somente se TODAS as etapas obrigatorias concluiram. */
export async function finalizeRun(runId: number, forced?: string) {
  const steps = await db.query("SELECT * FROM research_steps WHERE run_id=$1", [runId]);
  let status = forced;
  if (!status) {
    const req = steps.filter((s) => s.required);
    const ok = (s: any) => s.status === "concluida";
    if (req.every(ok)) status = "concluida";
    else if (steps.some((s) => ["concluida", "parcial"].includes(s.status))) status = "parcial";
    else status = "falha";
  }
  const pend = steps.filter((s) => s.required && s.status !== "concluida").map((s) => `${STEPS.find((x) => x.step === s.step)?.label}: ${s.status.replace(/_/g, " ")}`);
  const cost = steps.reduce((a, s) => a + Number(s.cost_usd || 0), 0);
  await db.query("UPDATE research_runs SET status=$2, finished_at=now(), cost_usd=$3, summary=$4 WHERE id=$1",
    [runId, status, cost, pend.length ? `Etapas obrigatórias não concluídas — ${pend.join("; ")}` : "Todas as etapas obrigatórias concluídas"]);
}
