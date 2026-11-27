// Leituras consolidadas: itens do lote (lista principal), resumo financeiro e detalhe do produto.
import { db, one, type Q } from "./db.ts";
import { groupStats, commercialConfidence, technicalConfidence, compatConfidence, outlierIds, round2, type Listing } from "./calc.ts";

const ITEM_SQL = `
SELECT li.id, li.lot_id, li.product_id, li.sku, li.quantity, li.original_description, li.original_commodity, li.existed_before,
  l.code AS lot_code,
  alias_cat.name AS category_from_commodity,
  tv.status AS tech_status, tv.data AS tech_data, tv.created_at AS tech_at, tvu.name AS tech_by,
  ai.output AS ai_output, ai.id AS ai_id, ai.created_at AS ai_at,
  cv_last.status AS com_status, cv_last.unit_price AS com_last_price, cv_last.created_at AS com_at, cvu.name AS com_by,
  cv_ok.unit_price AS approved_price, cv_ok.created_at AS approved_at,
  rr.status AS research_status, rr.kind AS research_kind, rr.created_at AS research_at, rr.finished_at AS research_finished_at,
  (SELECT count(*)::int FROM compatibilities c WHERE c.product_id=li.product_id) AS compat_count,
  (SELECT count(*)::int FROM compatibilities c WHERE c.product_id=li.product_id AND c.confirmation IN ('oficial_sku','oficial_modelo')) AS compat_official,
  (SELECT count(*)::int FROM product_codes pc WHERE pc.product_id=li.product_id AND pc.confirmation='oficial') AS official_codes,
  (SELECT count(*)::int FROM tech_facts tf WHERE tf.product_id=li.product_id AND tf.confirmation='oficial') AS official_facts,
  (SELECT count(*)::int FROM tech_facts tf WHERE tf.product_id=li.product_id AND tf.confirmation<>'oficial') AS other_facts,
  (SELECT string_agg(pc.code, ', ') FROM product_codes pc WHERE pc.product_id=li.product_id AND pc.code_type='fru' AND pc.confirmation='oficial') AS fru,
  (SELECT max(collected_at) FROM listings x WHERE x.product_id=li.product_id) AS last_market_at
FROM lot_items li
JOIN lots l ON l.id=li.lot_id
LEFT JOIN category_aliases ca ON ca.raw = upper(trim(li.original_commodity))
LEFT JOIN categories alias_cat ON alias_cat.id = ca.category_id
LEFT JOIN LATERAL (SELECT * FROM tech_validations t WHERE t.product_id=li.product_id ORDER BY version DESC LIMIT 1) tv ON TRUE
LEFT JOIN users tvu ON tvu.id = tv.created_by
LEFT JOIN LATERAL (SELECT * FROM ai_consolidations a WHERE a.product_id=li.product_id ORDER BY (a.lot_id = li.lot_id) DESC NULLS LAST, a.created_at DESC LIMIT 1) ai ON TRUE
LEFT JOIN LATERAL (SELECT * FROM commercial_validations c WHERE c.lot_item_id=li.id ORDER BY version DESC LIMIT 1) cv_last ON TRUE
LEFT JOIN users cvu ON cvu.id = cv_last.created_by
LEFT JOIN LATERAL (SELECT * FROM commercial_validations c WHERE c.lot_item_id=li.id AND c.status='aprovada' ORDER BY version DESC LIMIT 1) cv_ok ON TRUE
LEFT JOIN LATERAL (SELECT * FROM research_runs r WHERE r.product_id=li.product_id ORDER BY r.created_at DESC LIMIT 1) rr ON TRUE
`;

export async function listingsFor(q: Q, productIds: number[]): Promise<Map<number, Listing[]>> {
  const m = new Map<number, Listing[]>();
  if (!productIds.length) return m;
  const rows = await q.query<any>("SELECT * FROM listings WHERE product_id = ANY($1) ORDER BY id", [productIds]);
  for (const r of rows) { if (!m.has(r.product_id)) m.set(r.product_id, []); m.get(r.product_id)!.push(r); }
  return m;
}

export async function lotItems(lotId: number | null, opts: { itemIds?: number[]; productId?: number } = {}) {
  const where: string[] = [], p: unknown[] = [];
  if (lotId != null) { p.push(lotId); where.push(`li.lot_id=$${p.length}`); }
  if (opts.itemIds) { p.push(opts.itemIds); where.push(`li.id = ANY($${p.length})`); }
  if (opts.productId) { p.push(opts.productId); where.push(`li.product_id=$${p.length}`); }
  const rows = await db.query<any>(`${ITEM_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY li.id`, p);
  const ls = await listingsFor(db, [...new Set(rows.map((r) => r.product_id))]);
  return rows.map((r) => enrich(r, ls.get(r.product_id) || []));
}

function enrich(r: any, listings: Listing[]) {
  const stats = groupStats(listings);
  const ai = r.ai_output || null;
  const td = r.tech_data || {};
  const approved = r.approved_price != null ? Number(r.approved_price) : null;
  const aiPrice = ai?.precificacao && !ai.precificacao.abster ? ai.precificacao.preco_sugerido ?? null : null;
  const qty = Number(r.quantity) || 0;
  const techValidated = r.tech_status === "aprovada";
  const tech = technicalConfidence({ officialCodes: r.official_codes, officialFacts: r.official_facts, otherFacts: r.other_facts, validated: techValidated });
  const compat = compatConfidence({ oficial_sku: r.compat_official, fonte_complementar: r.compat_count - r.compat_official });
  const com = commercialConfidence(stats);
  const g = stats.groups;
  return {
    id: r.id, lot_id: r.lot_id, lot_code: r.lot_code, product_id: r.product_id, sku: r.sku, quantity: qty,
    original_description: r.original_description, original_commodity: r.original_commodity, existed_before: r.existed_before,
    name: td.nome_comercial || ai?.nome_comercial || null,
    name_source: td.nome_comercial ? "validado" : ai?.nome_comercial ? "ia" : null,
    category: td.categoria || ai?.categoria || r.category_from_commodity || null,
    category_source: td.categoria ? "validado" : ai?.categoria ? "ia" : r.category_from_commodity ? "commodity" : null,
    fru: r.fru,
    ai_price: aiPrice, ai_abstained: !!ai?.precificacao?.abster, ai_at: r.ai_at,
    approved_price: approved, approved_at: r.approved_at,
    total_ai: aiPrice != null ? round2(aiPrice * qty) : null,
    total_validated: approved != null ? round2(approved * qty) : null,
    com_status: r.com_status || "pendente", com_last_price: r.com_last_price, com_by: r.com_by, com_at: r.com_at,
    has_draft_after_approval: r.com_status === "rascunho" && approved != null,
    tech_status: r.tech_status || "pendente", tech_by: r.tech_by, tech_at: r.tech_at,
    full_status: techValidated && approved != null ? "aprovado" : "pendente",
    research_status: r.research_status || "nao_pesquisado", research_at: r.research_at,
    compat_count: r.compat_count, compat_official: r.compat_official,
    nat_count: g.nacional_direta.encontrados, int_count: g.internacional_direta.encontrados, ind_count: g.indireta.encontrados,
    nat_min: g.nacional_direta.menor, nat_median: g.nacional_direta.mediana, int_median: g.internacional_direta.mediana,
    conf_tech: tech.level, conf_compat: compat.level, conf_com: com.level,
    last_market_at: r.last_market_at,
    validator: r.com_by || r.tech_by || null,
  };
}
export type Item = ReturnType<typeof enrich>;

export function financialSummary(items: Item[]) {
  let units = 0, unitsOk = 0, totalOk = 0, totalAi = 0, unitsAi = 0, pendingAiTotal = 0, skusOk = 0;
  for (const i of items) {
    units += i.quantity;
    if (i.approved_price != null) { unitsOk += i.quantity; totalOk += i.total_validated!; skusOk++; }
    else if (i.total_ai != null) pendingAiTotal += i.total_ai;
    if (i.total_ai != null) { totalAi += i.total_ai; unitsAi += i.quantity; }
  }
  return {
    skus: items.length, units, units_approved: unitsOk, units_pending: units - unitsOk, skus_price_approved: skusOk,
    pct_units_approved: units ? round2((unitsOk / units) * 100) : 0,
    potential_validated: round2(totalOk), potential_ai: round2(totalAi), units_with_ai_price: unitsAi,
    pending_ai_reference: round2(pendingAiTotal),
  };
}

export function lotHeader(items: Item[]) {
  const researched = items.filter((i) => ["concluida", "parcial"].includes(i.research_status)).length;
  const validated = items.filter((i) => i.full_status === "aprovado").length;
  return {
    ...financialSummary(items),
    researched, validated, pending: items.length - validated,
    pct_research: items.length ? round2((researched / items.length) * 100) : 0,
    pct_validation: items.length ? round2((validated / items.length) * 100) : 0,
  };
}

export async function productDetail(productId: number, lotItemId?: number) {
  const product = await one(db, "SELECT * FROM products WHERE id=$1", [productId]);
  if (!product) return null;
  const [items, rawRows, codes, facts, images, compat, listings, sources, aiAll, techVals, runs, history, categories] = await Promise.all([
    lotItems(null, { productId }),
    db.query(`SELECT r.*, l.code AS lot_code, l.column_map->'headers' AS headers FROM lot_raw_rows r JOIN lots l ON l.id=r.lot_id WHERE r.sku=$1 ORDER BY r.lot_id, r.row_number`, [product.sku]),
    db.query(`SELECT pc.*, s.url AS source_url, s.title AS source_title, s.source_type, s.reference AS source_reference, s.fetched_at FROM product_codes pc LEFT JOIN sources s ON s.id=pc.source_id WHERE pc.product_id=$1 ORDER BY pc.id`, [productId]),
    db.query(`SELECT tf.*, s.url AS source_url, s.title AS source_title, s.source_type, s.reference AS source_reference, s.fetched_at FROM tech_facts tf LEFT JOIN sources s ON s.id=tf.source_id WHERE tf.product_id=$1 ORDER BY tf.field, tf.id`, [productId]),
    db.query(`SELECT * FROM product_images WHERE product_id=$1 ORDER BY id`, [productId]),
    db.query(`SELECT c.*, s.url AS source_url, s.title AS source_title, s.source_type, s.reference AS source_reference FROM compatibilities c LEFT JOIN sources s ON s.id=c.source_id WHERE c.product_id=$1 ORDER BY c.confirmation, c.machine_type, c.model`, [productId]),
    db.query<any>(`SELECT x.*, u.name AS added_by_name, eu.name AS excluded_by_name FROM listings x LEFT JOIN users u ON u.id=x.added_by LEFT JOIN users eu ON eu.id=x.excluded_by WHERE x.product_id=$1 ORDER BY x.collected_at DESC, x.id`, [productId]),
    db.query(`SELECT * FROM sources WHERE product_id=$1 ORDER BY fetched_at DESC`, [productId]),
    db.query(`SELECT * FROM ai_consolidations WHERE product_id=$1 ORDER BY created_at DESC`, [productId]),
    db.query(`SELECT t.*, u.name AS user_name FROM tech_validations t LEFT JOIN users u ON u.id=t.created_by WHERE t.product_id=$1 ORDER BY version DESC`, [productId]),
    db.query(`SELECT r.*, (SELECT json_agg(s ORDER BY s.seq) FROM research_steps s WHERE s.run_id=r.id) AS steps FROM research_runs r WHERE r.product_id=$1 ORDER BY r.created_at DESC`, [productId]),
    db.query(`SELECT h.*, u.name AS user_name FROM change_log h LEFT JOIN users u ON u.id=h.user_id WHERE h.product_id=$1 ORDER BY h.created_at DESC LIMIT 500`, [productId]),
    db.query(`SELECT * FROM categories ORDER BY name`),
  ]);
  const item = lotItemId ? items.find((i) => i.id === lotItemId) : items[items.length - 1];
  const comVals = item ? await db.query(`SELECT c.*, u.name AS user_name FROM commercial_validations c LEFT JOIN users u ON u.id=c.created_by WHERE c.lot_item_id=$1 ORDER BY version DESC`, [item.id]) : [];
  const stats = groupStats(listings as any);
  const outliers = outlierIds(listings as any);
  return {
    product, item, items, rawRows, codes, facts, images, compat, sources, aiAll, techVals, comVals, runs, history, categories,
    listings: listings.map((l: any) => ({ ...l, calc: stats.listings[l.id], outlier: outliers.has(l.id) })),
    stats: stats.groups,
  };
}
