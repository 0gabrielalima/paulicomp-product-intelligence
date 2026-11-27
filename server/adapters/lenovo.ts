// Lenovo Parts Lookup - fluxo SEMIAUTOMATICO (sem API publica; nao automatizamos o endpoint interno sem autorizacao).
// 1) O sistema gera blocos de ate 100 SKUs separados por ";".
// 2) O colaborador cola no site (opcao "Numero da Peca"), confere e baixa a "Lista de downloads" ou registra o resultado.
// 3) O resultado e importado aqui e gravado como fonte oficial com data/hora e referencia.
import { db, one, logChange, type Q } from "../db.ts";

export const PARTS_LOOKUP_URL = "https://support.lenovo.com/br/pt/parts-lookup";
export const BATCH_SIZE = 100;

export async function ensureBatches(lotId: number) {
  const existing = await db.query("SELECT * FROM lenovo_batches WHERE lot_id=$1 ORDER BY id", [lotId]);
  if (existing.length) return existing;
  const skus = (await db.query<{ sku: string }>("SELECT sku FROM lot_items WHERE lot_id=$1 ORDER BY id", [lotId])).map((r) => r.sku);
  for (let i = 0; i < skus.length; i += BATCH_SIZE)
    await db.query("INSERT INTO lenovo_batches(lot_id,skus) VALUES($1,$2)", [lotId, skus.slice(i, i + BATCH_SIZE)]);
  return db.query("SELECT * FROM lenovo_batches WHERE lot_id=$1 ORDER BY id", [lotId]);
}

export type LenovoResult = {
  sku: string;                 // SKU consultado (como esta no lote)
  fru?: string;                // Numero da peca de servico retornado
  official_name?: string;
  commodity?: string;
  machine_types?: string[];    // lista "Compatibilidade"/produtos
  machines?: { model?: string; machine_type: string }[]; // modelo + machine type, como exibido no site
  substitutes?: { code: string; relation?: string; name?: string }[];
  images?: string[];
  specs?: { field: string; value: string }[];
  not_found?: boolean;         // "Pecas desconhecidas" sem correspondencia
};

const splitList = (s?: string | null) => (s || "").split(/[;,\n|]+/).map((x) => x.trim()).filter(Boolean);

/** Converte uma linha importada (mapeamento de colunas) em LenovoResult. */
export function rowToResult(r: Record<string, string>): LenovoResult {
  return {
    sku: (r.sku || "").replace(/\s+/g, "").toUpperCase(),
    fru: r.fru?.trim() || undefined,
    official_name: r.official_name?.trim() || undefined,
    commodity: r.commodity?.trim() || undefined,
    machine_types: splitList(r.machine_types),
    substitutes: splitList(r.substitutes).map((code) => ({ code, relation: "substituto" })),
    images: splitList(r.images).filter((u) => /^https?:\/\//.test(u)),
  };
}

export async function recordLenovoResult(q: Q, productId: number, res: LenovoResult, ctx: { userId?: number | null; reference: string; url?: string; runId?: number | null; fetchedAt?: string }) {
  const src = await one(q, `INSERT INTO sources(product_id,run_id,source_type,url,title,reference,fetched_at,created_by)
    VALUES($1,$2,'lenovo_parts_lookup',$3,$4,$5,COALESCE($6::timestamptz, now()),$7) RETURNING id`,
    [productId, ctx.runId ?? null, ctx.url || PARTS_LOOKUP_URL, "Lenovo Parts Lookup", ctx.reference, ctx.fetchedAt ?? null, ctx.userId ?? null]);
  const sid = src!.id;
  let n = 0;
  if (res.not_found) {
    await q.query(`INSERT INTO tech_facts(product_id,run_id,source_id,field,value,confirmation) VALUES($1,$2,$3,'Resultado Lenovo Parts Lookup','SKU não encontrado / sem correspondência','oficial')`, [productId, ctx.runId ?? null, sid]);
  }
  if (res.fru) { await q.query(`INSERT INTO product_codes(product_id,code,code_type,confirmation,source_id,run_id,notes) VALUES($1,$2,'fru','oficial',$3,$4,'Número da peça de serviço retornado pelo Parts Lookup')`, [productId, res.fru.toUpperCase(), sid, ctx.runId ?? null]); n++; }
  if (res.official_name) { await q.query(`INSERT INTO tech_facts(product_id,run_id,source_id,field,value,confirmation) VALUES($1,$2,$3,'Nomenclatura oficial Lenovo',$4,'oficial')`, [productId, ctx.runId ?? null, sid, res.official_name]); n++; }
  if (res.commodity) { await q.query(`INSERT INTO tech_facts(product_id,run_id,source_id,field,value,confirmation) VALUES($1,$2,$3,'Commodity Lenovo',$4,'oficial')`, [productId, ctx.runId ?? null, sid, res.commodity]); n++; }
  for (const s of res.specs || []) { await q.query(`INSERT INTO tech_facts(product_id,run_id,source_id,field,value,confirmation) VALUES($1,$2,$3,$4,$5,'oficial')`, [productId, ctx.runId ?? null, sid, s.field, s.value]); n++; }
  for (const s of res.substitutes || []) {
    await q.query(`INSERT INTO product_codes(product_id,code,code_type,confirmation,source_id,run_id,notes) VALUES($1,$2,$3,'oficial',$4,$5,$6)`,
      [productId, s.code.toUpperCase(), s.relation === "equivalente" ? "equivalente" : "substituto", sid, ctx.runId ?? null, s.name || null]); n++;
  }
  for (const mt of res.machine_types || []) {
    await q.query(`INSERT INTO compatibilities(product_id,run_id,source_id,brand,machine_type,confirmation,notes) VALUES($1,$2,$3,'Lenovo',$4,'oficial_sku','Lista de compatibilidade do Parts Lookup')`, [productId, ctx.runId ?? null, sid, mt.toUpperCase()]); n++;
  }
  for (const m of res.machines || []) {
    await q.query(`INSERT INTO compatibilities(product_id,run_id,source_id,brand,model,machine_type,confirmation,notes) VALUES($1,$2,$3,'Lenovo',$4,$5,'oficial_sku','Lista de compatibilidade do Parts Lookup')`, [productId, ctx.runId ?? null, sid, m.model || null, m.machine_type.toUpperCase()]); n++;
  }
  for (const u of res.images || []) await q.query(`INSERT INTO product_images(product_id,url,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [productId, u, sid]);
  await logChange(q, { entity: "fonte", entity_id: sid, product_id: productId, action: "consulta_lenovo_registrada", new_value: { ...res, itens: n }, reason: ctx.reference, user_id: ctx.userId });
  return { source_id: sid, items: n };
}
