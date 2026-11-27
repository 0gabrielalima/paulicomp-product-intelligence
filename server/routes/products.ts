import { Router } from "express";
import { db, one, logChange, getSetting } from "../db.ts";
import { requireRole, can } from "../auth.ts";
import { productDetail, lotItems } from "../views.ts";
import { fetchPtax, convert } from "../adapters/fx.ts";
import { recordLenovoResult } from "../adapters/lenovo.ts";
import { createRun, finalizeRun, STEPS } from "../worker/pipeline.ts";
import { z } from "zod";
import { enqueue } from "../worker/queue.ts";
import { groupStats, commercialConfidence } from "../calc.ts";

export const products = Router();

products.get("/products", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = await db.query(`SELECT p.id, p.sku, p.created_at,
      (SELECT count(*)::int FROM lot_items li WHERE li.product_id=p.id) AS lots,
      (SELECT sum(quantity) FROM lot_items li WHERE li.product_id=p.id) AS units,
      (SELECT original_description FROM lot_items li WHERE li.product_id=p.id ORDER BY id DESC LIMIT 1) AS description,
      (SELECT original_commodity FROM lot_items li WHERE li.product_id=p.id ORDER BY id DESC LIMIT 1) AS commodity,
      (SELECT id FROM lot_items li WHERE li.product_id=p.id ORDER BY id DESC LIMIT 1) AS last_item_id,
      t.status AS tech_status, t.data->>'nome_comercial' AS name,
      (SELECT string_agg(code, ', ') FROM product_codes pc WHERE pc.product_id=p.id AND pc.code_type='fru') AS fru,
      (SELECT max(created_at) FROM research_runs r WHERE r.product_id=p.id) AS last_research
    FROM products p
    LEFT JOIN LATERAL (SELECT * FROM tech_validations t WHERE t.product_id=p.id ORDER BY version DESC LIMIT 1) t ON TRUE
    WHERE $1 = '' OR p.sku ILIKE '%'||$1||'%' OR t.data->>'nome_comercial' ILIKE '%'||$1||'%'
      OR EXISTS (SELECT 1 FROM product_codes pc WHERE pc.product_id=p.id AND pc.code ILIKE '%'||$1||'%')
      OR EXISTS (SELECT 1 FROM lot_items li WHERE li.product_id=p.id AND li.original_description ILIKE '%'||$1||'%')
    ORDER BY p.sku LIMIT 1000`, [q]);
  res.json(rows);
});

products.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  const rows = await db.query(`SELECT DISTINCT ON (p.id) p.id AS product_id, p.sku, li.id AS item_id, li.lot_id, l.code AS lot_code, li.original_description,
      (SELECT data->>'nome_comercial' FROM tech_validations t WHERE t.product_id=p.id ORDER BY version DESC LIMIT 1) AS name,
      (SELECT string_agg(code, ', ') FROM product_codes pc WHERE pc.product_id=p.id AND pc.code ILIKE '%'||$1||'%') AS matched_code
    FROM products p LEFT JOIN lot_items li ON li.product_id=p.id LEFT JOIN lots l ON l.id=li.lot_id
    WHERE p.sku ILIKE '%'||$1||'%' OR li.original_description ILIKE '%'||$1||'%'
      OR EXISTS (SELECT 1 FROM product_codes pc WHERE pc.product_id=p.id AND pc.code ILIKE '%'||$1||'%')
      OR EXISTS (SELECT 1 FROM tech_validations t WHERE t.product_id=p.id AND t.data->>'nome_comercial' ILIKE '%'||$1||'%')
    ORDER BY p.id, li.id DESC LIMIT 20`, [q]);
  res.json(rows);
});

products.get("/products/:id", async (req, res) => {
  const d = await productDetail(Number(req.params.id), req.query.item ? Number(req.query.item) : undefined);
  if (!d) return res.status(404).json({ error: "Produto não encontrado." });
  res.json(d);
});

// Indicadores de mercado recalculados com filtros (condicao, originalidade, disponibilidade, versao, a vista/parcelado, correspondencia)
products.get("/products/:id/stats", async (req, res) => {
  const ls = await db.query<any>("SELECT * FROM listings WHERE product_id=$1", [req.params.id]);
  const f = req.query as Record<string, string>;
  const s = groupStats(ls, { mode: f.mode === "parcelado" ? "parcelado" : "avista", condition: f.condition || undefined, originality: f.originality || undefined, availability: f.availability || undefined, version: f.version || undefined, match_type: f.match_type || undefined });
  res.json({ groups: s.groups, listings: s.listings, confidence: commercialConfidence(s) });
});

// ---------- Validacao tecnica (versionada; nunca sobrescreve) ----------
const TECH_FIELDS = ["nome_comercial", "marca", "fabricante", "modelo", "categoria", "subcategoria", "part_number", "especificacoes", "compatibilidades", "codigos_equivalentes", "condicao_recebida", "versao_comercial", "originalidade", "titulo", "descricao", "observacoes"];

products.post("/products/:id/validation", async (req, res) => {
  const pid = Number(req.params.id);
  const { data, status, reason, lot_id } = req.body;
  if (!["rascunho", "aprovada", "revisao_solicitada", "nao_identificado"].includes(status)) return res.status(400).json({ error: "Status inválido." });
  if (["aprovada", "nao_identificado"].includes(status) && !can(req.user, "validador")) return res.status(403).json({ error: "Apenas validadores aprovam ou marcam como não identificado." });
  if (!can(req.user, "validador", "pesquisador")) return res.status(403).json({ error: "Sem permissão." });
  const clean: Record<string, unknown> = {};
  for (const k of TECH_FIELDS) if (data?.[k] !== undefined) clean[k] = data[k];
  await db.tx(async (q) => {
    const prev = await one(q, "SELECT * FROM tech_validations WHERE product_id=$1 ORDER BY version DESC LIMIT 1", [pid]);
    const ai = await one(q, "SELECT id FROM ai_consolidations WHERE product_id=$1 ORDER BY created_at DESC LIMIT 1", [pid]);
    const v = await one(q, "INSERT INTO tech_validations(product_id,version,status,data,based_on_ai_id,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [pid, (prev?.version || 0) + 1, status, JSON.stringify(clean), ai?.id ?? null, req.user!.id]);
    const old = prev?.data || {};
    for (const k of TECH_FIELDS) {
      if (JSON.stringify(old[k] ?? null) !== JSON.stringify(clean[k] ?? null))
        await logChange(q, { entity: "validacao_tecnica", entity_id: v!.id, product_id: pid, lot_id: lot_id ?? null, action: "campo_alterado", field: k, old_value: old[k] ?? null, new_value: clean[k] ?? null, reason, user_id: req.user!.id });
    }
    if (prev?.status !== status) await logChange(q, { entity: "validacao_tecnica", entity_id: v!.id, product_id: pid, lot_id: lot_id ?? null, action: `status_${status}`, old_value: prev?.status ?? null, new_value: status, reason, user_id: req.user!.id });
  });
  res.json({ ok: true });
});

// ---------- Anuncios ----------
async function ownMatch(l: { url: string; seller?: string | null; store?: string | null }) {
  const p = (await getSetting<any>("proprios")) || {};
  const hay = [l.url, l.seller, l.store].filter(Boolean).join(" ").toLowerCase();
  const terms = [...(p.dominios || []), ...(p.urls || []), ...(p.vendedores || []), ...(p.contas_marketplace || []), ...(p.nomes || [])].map((x: string) => String(x).toLowerCase().trim()).filter(Boolean);
  return terms.some((t: string) => hay.includes(t));
}
export function dedupeKey(url: string) {
  try {
    const u = new URL(url);
    const ml = (u.pathname + u.search).match(/MLB-?(\d{6,})/i);
    if (ml) return `mlb:${ml[1]}`;
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch { return url.toLowerCase(); }
}

products.post("/products/:id/listings", requireRole("pesquisador", "validador"), async (req, res) => {
  const pid = Number(req.params.id);
  const b = req.body;
  if (!/^https?:\/\/\S+$/.test(b.url || "")) return res.status(400).json({ error: "O link direto do anúncio é obrigatório (http/https)." });
  if (!b.title?.trim()) return res.status(400).json({ error: "Informe o título do anúncio." });
  if (!b.match_type) return res.status(400).json({ error: "Informe o tipo de correspondência." });
  const currency = String(b.currency || "BRL").toUpperCase();
  const price = b.price_original === "" || b.price_original == null ? null : Number(b.price_original);
  let fx: any = null;
  if (currency !== "BRL" && price != null) {
    try { fx = await fetchPtax(currency); } catch (e: any) { return res.status(400).json({ error: `Não foi possível converter: ${e.message}` }); }
  }
  const key = dedupeKey(b.url);
  const dup = await one(db, "SELECT id FROM listings WHERE product_id=$1 AND dedupe_key=$2 ORDER BY id LIMIT 1", [pid, key]);
  const isOwn = await ownMatch(b);
  const n = (v: any) => (v === "" || v == null ? null : Number(v));
  const row = await one(db, `INSERT INTO listings(product_id,market,competition,store,marketplace,seller,country,title,title_translated,sku_informed,pn_informed,currency,price_original,price_installment,installments,
      fx_quote_id,fx_rate,fx_source,fx_at,price_brl,shipping,taxes,condition,originality,commercial_version,availability,qty_available,qty_sold,delivery,url,price_origin,match_type,match_evidence,is_own,dedupe_key,excluded,exclusion_reason,notes,added_by,run_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$39,$31,$32,$33,$34,$35,$36,$37,$38,$40) RETURNING id`,
    [pid, b.market === "internacional" ? "internacional" : "nacional", b.competition === "indireta" ? "indireta" : "direta", b.store || null, b.marketplace || null, b.seller || null, b.country || (b.market === "internacional" ? null : "Brasil"),
      b.title.trim(), b.title_translated || null, b.sku_informed || null, b.pn_informed || null, currency, price, n(b.price_installment), n(b.installments),
      fx?.id || null, fx?.rate ?? (currency === "BRL" ? 1 : null), fx?.source ?? null, fx?.quoted_at ?? null,
      price == null ? null : currency === "BRL" ? price : convert(price, fx.rate), n(b.shipping), n(b.taxes),
      b.condition || "nao_informada", b.originality || "nao_confirmada", b.commercial_version || "nao_identificada", b.availability || "estoque_nao_confirmado",
      n(b.qty_available), n(b.qty_sold), b.delivery || null, b.url.trim(), b.match_type, b.match_evidence || null, isOwn, key,
      !!dup, dup ? `Duplicado do anúncio #${dup.id} (mesmo link)` : null, b.notes || null, req.user!.id,
      ["pagina", "indexado"].includes(b.price_origin) ? b.price_origin : "manual", n(b.run_id)]);
  await logChange(db, { entity: "anuncio", entity_id: row!.id, product_id: pid, action: b.price_origin && b.price_origin !== "manual" ? "anuncio_pesquisa_assistida" : "anuncio_manual_adicionado", new_value: { url: b.url, preco: price, moeda: currency, proprio: isOwn, duplicado_de: dup?.id ?? null }, user_id: req.user!.id });
  res.json({ id: row!.id, duplicate_of: dup?.id ?? null, is_own: isOwn });
});

const LISTING_EDITABLE = ["store", "marketplace", "seller", "title", "price_original", "price_installment", "installments", "shipping", "condition", "originality", "commercial_version", "availability", "qty_available", "qty_sold", "match_type", "match_evidence", "competition", "notes", "is_own"];

products.patch("/listings/:id", requireRole("pesquisador", "validador"), async (req, res) => {
  const l = await one(db, "SELECT * FROM listings WHERE id=$1", [req.params.id]);
  if (!l) return res.status(404).json({ error: "Anúncio não encontrado." });
  const b = req.body;
  if (b.excluded === true && !b.exclusion_reason?.trim()) return res.status(400).json({ error: "Informe o motivo da exclusão." });
  await db.tx(async (q) => {
    if (b.excluded !== undefined && b.excluded !== l.excluded) {
      await q.query("UPDATE listings SET excluded=$2, exclusion_reason=$3, excluded_by=$4 WHERE id=$1", [l.id, !!b.excluded, b.excluded ? b.exclusion_reason : null, req.user!.id]);
      await logChange(q, { entity: "anuncio", entity_id: l.id, product_id: l.product_id, action: b.excluded ? "anuncio_desconsiderado" : "anuncio_reincluido", old_value: l.exclusion_reason, new_value: b.exclusion_reason ?? null, reason: b.exclusion_reason ?? b.reason, user_id: req.user!.id });
    }
    for (const k of LISTING_EDITABLE) {
      if (b[k] === undefined || String(b[k] ?? "") === String(l[k] ?? "")) continue;
      // o valor original fica no historico; o anuncio corrigido passa a ser marcado como corrigido manualmente
      await q.query(`UPDATE listings SET ${k}=$2, notes = COALESCE(notes,'') || $3 WHERE id=$1`, [l.id, b[k] === "" ? null : b[k], ` [${k} corrigido manualmente]`]);
      await logChange(q, { entity: "anuncio", entity_id: l.id, product_id: l.product_id, action: "anuncio_corrigido", field: k, old_value: l[k], new_value: b[k], reason: b.reason, user_id: req.user!.id });
    }
    if (b.price_original !== undefined && l.currency !== "BRL" && l.fx_rate) // reconverte com a MESMA taxa gravada
      await q.query("UPDATE listings SET price_brl=$2 WHERE id=$1", [l.id, b.price_original === "" ? null : convert(Number(b.price_original), Number(l.fx_rate))]);
  });
  res.json({ ok: true });
});

// ---------- Fontes e compatibilidades manuais ----------
products.post("/products/:id/compat", requireRole("pesquisador", "validador"), async (req, res) => {
  const pid = Number(req.params.id), b = req.body;
  if (!b.url && !b.reference) return res.status(400).json({ error: "Informe a fonte (link ou referência)." });
  const lines = String(b.models || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: "Informe ao menos um modelo (um por linha)." });
  await db.tx(async (q) => {
    const s = await one(q, "INSERT INTO sources(product_id,source_type,url,title,reference,created_by) VALUES($1,'manual',$2,$3,$4,$5) RETURNING id", [pid, b.url || null, b.title || null, b.reference || null, req.user!.id]);
    for (const m of lines) await q.query("INSERT INTO compatibilities(product_id,source_id,brand,line,model,machine_type,confirmation,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [pid, s!.id, b.brand || "Lenovo", b.line || null, b.kind === "machine_type" ? null : m, b.kind === "machine_type" ? m.toUpperCase() : null, b.confirmation || "necessita_validacao", b.notes || null]);
    await logChange(q, { entity: "compatibilidade", product_id: pid, action: "compatibilidades_adicionadas", new_value: { modelos: lines, confirmacao: b.confirmation }, user_id: req.user!.id });
  });
  res.json({ ok: true, added: lines.length });
});

products.post("/products/:id/sources", requireRole("pesquisador", "validador"), async (req, res) => {
  const pid = Number(req.params.id), b = req.body;
  if (!b.url && !b.reference) return res.status(400).json({ error: "Informe o link ou a referência da fonte." });
  await db.tx(async (q) => {
    const s = await one(q, "INSERT INTO sources(product_id,source_type,url,title,reference,created_by,run_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [pid, b.source_type || "manual", b.url || null, b.title || null, b.reference || null, req.user!.id, b.run_id ?? null]);
    for (const f of b.facts || []) if (f.field && f.value) await q.query("INSERT INTO tech_facts(product_id,source_id,field,value,confirmation,run_id) VALUES($1,$2,$3,$4,$5,$6)", [pid, s!.id, f.field, f.value, f.confirmation || b.confirmation || "fonte_complementar", b.run_id ?? null]);
    await logChange(q, { entity: "fonte", entity_id: s!.id, product_id: pid, action: "fonte_adicionada", new_value: b, user_id: req.user!.id });
  });
  res.json({ ok: true });
});

products.post("/products/:id/lenovo", requireRole("pesquisador", "validador"), async (req, res) => {
  const pid = Number(req.params.id), b = req.body;
  const p = await one(db, "SELECT sku FROM products WHERE id=$1", [pid]);
  if (!p) return res.status(404).json({ error: "Produto não encontrado." });
  const list = (s?: string) => String(s || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!b.not_found && !b.fru && !b.official_name) return res.status(400).json({ error: "Informe o número da peça de serviço (FRU) ou o nome oficial — ou marque 'não encontrado'." });
  const r = await db.tx((q) => recordLenovoResult(q, pid, {
    sku: p.sku, fru: b.fru, official_name: b.official_name, commodity: b.commodity, not_found: !!b.not_found,
    machine_types: list(b.machine_types), machines: Array.isArray(b.machines) ? b.machines.filter((m: any) => m?.machine_type) : [],
    substitutes: [...list(b.substitutes).map((code) => ({ code, relation: "substituto" })), ...(Array.isArray(b.equivalents) ? b.equivalents.filter((e: any) => e?.code).map((e: any) => ({ code: String(e.code), relation: "equivalente", name: e.name })) : [])],
    images: list(b.images).filter((u) => /^https?:\/\//.test(u)),
    specs: String(b.specs || "").split("\n").map((l) => l.split(/[:\t]/)).filter((x) => x.length >= 2 && x[0].trim()).map(([f, ...v]) => ({ field: f.trim(), value: v.join(":").trim() })),
  }, { userId: req.user!.id, reference: b.reference || `Consulta registrada manualmente por ${req.user!.name}`, fetchedAt: b.consulted_at || undefined, runId: b.run_id ?? null }));
  res.json(r);
});

// ---------- Pesquisas ----------
async function selectProducts(body: any) {
  const { item_ids, lot_id, filter } = body;
  let items = await lotItems(lot_id ?? null, item_ids?.length ? { itemIds: item_ids } : {});
  const validade = await getSetting<any>("validade");
  const days = validade?.comercial_dias ?? 30;
  switch (filter) {
    case "nao_pesquisados": items = items.filter((i) => i.research_status === "nao_pesquisado"); break;
    case "nao_identificados": items = items.filter((i) => i.tech_status === "nao_identificado" || (!i.name && i.research_status !== "nao_pesquisado")); break;
    case "falhas": items = items.filter((i) => ["falha", "parcial"].includes(i.research_status)); break;
    case "precos_desatualizados": items = items.filter((i) => !i.last_market_at || (Date.now() - new Date(i.last_market_at).getTime()) / 86400_000 > days); break;
    case "baixa_confianca": items = items.filter((i) => ["baixa", "insuficiente"].includes(i.conf_tech) || ["baixa", "insuficiente"].includes(i.conf_com)); break;
  }
  const seen = new Map<number, { product_id: number; lot_id: number }>();
  for (const i of items) if (!seen.has(i.product_id)) seen.set(i.product_id, { product_id: i.product_id, lot_id: i.lot_id });
  return [...seen.values()];
}

// Não apresentar estimativa monetária fictícia: tarifas da OpenAI ainda não parametrizadas.
products.post("/research/estimate", async (req, res) => {
  const list = await selectProducts(req.body);
  const lim = (await getSetting<any>("limites")) || {};
  const kind = req.body.kind || "completa";
  res.json({ produtos: list.length, kind, modelo: "gemini-2.5-flash", buscas_por_sku: kind === "ia" ? 0 : lim.max_buscas_web_por_sku ?? 8, custo_estimado_por_sku_usd: null, custo_estimado_total_usd: null,
    observacao: "Custo monetário ainda não parametrizado. Pesquisa piloto limitada a dois SKUs por solicitação; não execute lotes completos.", ia_configurada: !!process.env.GEMINI_API_KEY });
});

products.post("/research/start", requireRole("pesquisador"), async (req, res) => {
  const kind = ["completa", "precos", "tecnica", "ia"].includes(req.body.kind) ? req.body.kind : "completa";
  const list = await selectProducts(req.body);
  if (list.length > 2) return res.status(400).json({error:"Versão piloto: selecione até dois SKUs por pesquisa."});
  let created = 0, skipped = 0;
  for (const p of list) {
    const active = await one(db, "SELECT 1 FROM jobs WHERE dedupe_key=$1 AND status IN ('queued','running','paused')", [`produto:${p.product_id}`]);
    if (active) { skipped++; continue; }
    const run = await createRun(p.product_id, kind, req.user!.id, p.lot_id);
    const job = await enqueue("research_run", { run_id: run.id }, { dedupeKey: `produto:${p.product_id}` });
    if (job) created++; else { skipped++; await db.query("UPDATE research_runs SET status='cancelada', summary='Já havia pesquisa ativa para este produto' WHERE id=$1", [run.id]); }
  }
  res.json({ created, skipped });
});

products.get("/research/runs", async (req, res) => {
  const p: unknown[] = [];
  const w: string[] = [];
  if (req.query.status) { p.push(req.query.status); w.push(`r.status=$${p.length}`); }
  if (req.query.lot_id) { p.push(req.query.lot_id); w.push(`r.lot_id=$${p.length}`); }
  const rows = await db.query(`SELECT r.*, pr.sku, l.code AS lot_code, u.name AS requested_by_name,
      (SELECT json_agg(json_build_object('id',s.id,'step',s.step,'source',s.source,'status',s.status,'required',s.required,'attempts',s.attempts,'error',s.error,'started_at',s.started_at,'finished_at',s.finished_at,'log',s.log,'cost_usd',s.cost_usd) ORDER BY s.seq) FROM research_steps s WHERE s.run_id=r.id) AS steps,
      j.id AS job_id, j.status AS job_status, j.attempts AS job_attempts, j.last_error AS job_error
    FROM research_runs r JOIN products pr ON pr.id=r.product_id LEFT JOIN lots l ON l.id=r.lot_id LEFT JOIN users u ON u.id=r.requested_by
    LEFT JOIN LATERAL (SELECT * FROM jobs j WHERE j.type='research_run' AND (j.payload->>'run_id')::int = r.id ORDER BY j.id DESC LIMIT 1) j ON TRUE
    ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY r.created_at DESC LIMIT 500`, p);
  const counts = await db.query("SELECT status, count(*)::int AS n FROM jobs GROUP BY status");
  res.json({ runs: rows, queue: Object.fromEntries(counts.map((c) => [c.status, c.n])), step_labels: Object.fromEntries(STEPS.map((s) => [s.step, s.label])) });
});

products.post("/research/runs/:id/:action", requireRole("pesquisador"), async (req, res) => {
  const runId = Number(req.params.id), action = req.params.action;
  const run = await one(db, "SELECT * FROM research_runs WHERE id=$1", [runId]);
  if (!run) return res.status(404).json({ error: "Pesquisa não encontrada." });
  const job = await one(db, "SELECT * FROM jobs WHERE type='research_run' AND (payload->>'run_id')::int=$1 ORDER BY id DESC LIMIT 1", [runId]);
  if (action === "pause") {
    if (!job || !["queued", "running"].includes(job.status)) return res.status(400).json({ error: "Não há tarefa ativa para pausar." });
    await db.query("UPDATE jobs SET status='paused', updated_at=now() WHERE id=$1", [job.id]);
    if (job.status === "queued") await db.query("UPDATE research_runs SET status='pausada' WHERE id=$1", [runId]);
  } else if (action === "resume") {
    if (job?.status !== "paused") return res.status(400).json({ error: "A pesquisa não está pausada." });
    await db.query("UPDATE jobs SET status='queued', updated_at=now(), run_after=now() WHERE id=$1", [job.id]);
    await db.query("UPDATE research_runs SET status='na_fila' WHERE id=$1", [runId]);
  } else if (action === "cancel") {
    if (job && ["queued", "paused"].includes(job.status)) { await db.query("UPDATE jobs SET status='cancelled', updated_at=now() WHERE id=$1", [job.id]); await db.query("UPDATE research_steps SET status='cancelada' WHERE run_id=$1 AND status='pendente'", [runId]); await db.query("UPDATE research_runs SET status='cancelada', finished_at=now() WHERE id=$1", [runId]); }
    else if (job?.status === "running") await db.query("UPDATE jobs SET status='cancelled', updated_at=now() WHERE id=$1", [job.id]);
    else return res.status(400).json({ error: "Nada a cancelar." });
  } else if (action === "retry_failed") {
    const failed = await db.query("SELECT step FROM research_steps WHERE run_id=$1 AND status NOT IN ('concluida','ignorada')", [runId]);
    if (!failed.length) return res.status(400).json({ error: "Todas as etapas já estão concluídas." });
    if (job && ["queued", "running", "paused"].includes(job.status)) return res.status(400).json({ error: "A pesquisa ainda está ativa." });
    await db.query("UPDATE research_steps SET status='pendente' WHERE run_id=$1 AND status NOT IN ('concluida','ignorada')", [runId]);
    await db.query("UPDATE research_runs SET status='na_fila', finished_at=NULL WHERE id=$1", [runId]);
    const j = await enqueue("research_run", { run_id: runId, only_steps: failed.map((f) => f.step) }, { dedupeKey: `produto:${run.product_id}` });
    if (!j) return res.status(400).json({ error: "Já existe pesquisa ativa para este produto." });
  } else return res.status(400).json({ error: "Ação inválida." });
  await logChange(db, { entity: "pesquisa", entity_id: runId, product_id: run.product_id, lot_id: run.lot_id, action: `pesquisa_${action}`, user_id: req.user!.id });
  res.json({ ok: true });
});

products.post("/queue/:action", requireRole("admin"), async (req, res) => {
  if (req.params.action === "pause_all") await db.query("UPDATE jobs SET status='paused', updated_at=now() WHERE status='queued'");
  else if (req.params.action === "resume_all") await db.query("UPDATE jobs SET status='queued', updated_at=now(), run_after=now() WHERE status='paused'");
  else return res.status(400).json({ error: "Ação inválida." });
  res.json({ ok: true });
});

// ---------- Pesquisa assistida (Claude Code, usando a assinatura do usuario; sem API paga) ----------
// A IA que pesquisa grava aqui uma consolidacao ESTRUTURADA e validada por schema. Nunca aprova nada.
const lvl = z.enum(["alta", "media", "baixa", "insuficiente"]);
const money = z.number().positive().nullable();
const AiSchema = z.object({
  nome_comercial: z.string().nullable(), categoria: z.string().nullable(), subcategoria: z.string().nullable().optional(),
  marca: z.string().nullable().optional(), fabricante: z.string().nullable().optional(), modelo: z.string().nullable().optional(), part_number: z.string().nullable().optional(),
  codigos_equivalentes: z.string().nullable().optional(), compatibilidades: z.string().nullable().optional(),
  condicao_recebida: z.string().nullable().optional(), versao_comercial: z.string().nullable().optional(), originalidade: z.string().nullable().optional(),
  titulo: z.string().nullable().optional(), descricao: z.string().nullable().optional(),
  especificacoes_obj: z.record(z.string(), z.string()).default({}),
  hipoteses: z.array(z.string()).default([]),
  divergencias: z.array(z.string()).default([]),
  precificacao: z.object({
    abster: z.boolean(), preco_sugerido: money, faixa_min: money, faixa_max: money, preco_agressivo: money, preco_inicial_alternativo: money,
    justificativa: z.string().min(1), limitacoes: z.array(z.string()).default([]), anuncios_referencia: z.array(z.number().int()).default([]),
  }).refine((p) => p.abster || p.preco_sugerido != null, "Sem abstenção, informe preco_sugerido"),
  confianca: z.object({
    tecnica: z.object({ nivel: lvl, justificativa: z.string() }),
    compatibilidade: z.object({ nivel: lvl, justificativa: z.string() }),
    comercial: z.object({ nivel: lvl, justificativa: z.string() }),
  }),
}).strict();

products.post("/products/:id/ai", requireRole("pesquisador"), async (req, res) => {
  const pid = Number(req.params.id);
  const parsed = AiSchema.safeParse(req.body.output);
  if (!parsed.success) return res.status(400).json({ error: "Saída da IA fora do schema", detalhes: parsed.error.issues });
  const refs = parsed.data.precificacao.anuncios_referencia;
  if (refs.length) {
    const ok = await db.query("SELECT id FROM listings WHERE product_id=$1 AND id = ANY($2)", [pid, refs]);
    if (ok.length !== refs.length) return res.status(400).json({ error: "anuncios_referencia contém anúncios que não pertencem a este produto" });
  }
  const prev = await one(db, "SELECT max(version) AS v FROM ai_consolidations WHERE product_id=$1", [pid]);
  const srcs = await db.query<{ id: number }>("SELECT id FROM sources WHERE product_id=$1", [pid]);
  const row = await one(db, "INSERT INTO ai_consolidations(product_id,run_id,lot_id,version,model,output,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [pid, req.body.run_id ?? null, req.body.lot_id ?? null, (prev?.v || 0) + 1, String(req.body.model || "claude-code (pesquisa assistida)"), JSON.stringify(parsed.data), srcs.map((s) => s.id)]);
  await logChange(db, { entity: "consolidacao_ia", entity_id: row!.id, product_id: pid, lot_id: req.body.lot_id ?? null, action: "analise_ia_registrada", new_value: { preco_sugerido: parsed.data.precificacao.preco_sugerido, abster: parsed.data.precificacao.abster }, user_id: req.user!.id });
  res.json({ id: row!.id });
});

const StepReport = z.object({ step: z.string(), status: z.enum(["concluida", "parcial", "falha", "ignorada", "nao_configurada", "aguardando_manual", "bloqueada"]), error: z.string().optional(), log: z.array(z.object({ msg: z.string(), data: z.unknown().optional() })).default([]) });

/** Abre uma execucao de pesquisa assistida (etapas 'executando') para vincular fontes e anuncios. */
products.post("/research/assisted/start", requireRole("pesquisador"), async (req, res) => {
  const pid = Number(req.body.product_id);
  const run = await createRun(pid, "completa", req.user!.id, req.body.lot_id ?? null);
  await db.query("UPDATE research_runs SET status='em_andamento', started_at=now(), summary='Pesquisa assistida (Claude Code)' WHERE id=$1", [run.id]);
  await db.query("UPDATE research_steps SET status='executando', started_at=now(), attempts=1 WHERE run_id=$1", [run.id]);
  res.json({ run_id: run.id });
});

/** Fecha a execucao com o resultado real de cada etapa. Concluida so se todas as obrigatorias concluiram. */
products.post("/research/assisted/:runId/finish", requireRole("pesquisador"), async (req, res) => {
  const runId = Number(req.params.runId);
  const steps = z.array(StepReport).safeParse(req.body.steps);
  if (!steps.success) return res.status(400).json({ error: "Etapas inválidas", detalhes: steps.error.issues });
  for (const s of steps.data)
    await db.query("UPDATE research_steps SET status=$3, error=$4, log=$5, finished_at=now() WHERE run_id=$1 AND step=$2",
      [runId, s.step, s.status, s.error ?? null, JSON.stringify(s.log.map((l) => ({ at: new Date().toISOString(), msg: l.msg, data: l.data ?? null })))]);
  await db.query("UPDATE research_steps SET status='ignorada', finished_at=now(), error='Não executada nesta pesquisa assistida' WHERE run_id=$1 AND status='executando'", [runId]);
  await finalizeRun(runId);
  await db.query("UPDATE research_runs SET summary = 'Pesquisa assistida (Claude Code). ' || summary WHERE id=$1", [runId]);
  res.json(await one(db, "SELECT id,status,summary FROM research_runs WHERE id=$1", [runId]));
});

// Ponte da pesquisa assistida: recebe dados coletados nas abas de pesquisa e grava em data/bridge (apenas pesquisadores)
products.post("/bridge/:name", requireRole("pesquisador"), async (req, res) => {
  const name = String(req.params.name);
  if (!/^[a-z0-9_-]{1,60}$/i.test(name)) return res.status(400).json({ error: "Nome inválido" });
  const dir = (await import("node:path")).resolve("data", "bridge");
  const fs = await import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/" + name + ".json", JSON.stringify(req.body));
  res.json({ ok: true });
});
