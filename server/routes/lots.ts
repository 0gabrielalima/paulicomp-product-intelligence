import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, one, logChange } from "../db.ts";
import { requireRole, can } from "../auth.ts";
import { readWorkbook, detectHeaderRow, suggestMapping, parseRows } from "../spreadsheet.ts";
import { lotItems, lotHeader, financialSummary } from "../views.ts";
import { ensureBatches, recordLenovoResult, rowToResult, PARTS_LOOKUP_URL } from "../adapters/lenovo.ts";

export const lots = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const UP = path.resolve("data", "uploads");
fs.mkdirSync(UP, { recursive: true });

function saveUpload(file: Express.Multer.File) {
  if (!/\.(xlsx|xls|csv|txt)$/i.test(file.originalname)) throw Object.assign(new Error("Formato não suportado. Use XLS, XLSX ou CSV."), { status: 400 });
  const token = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(path.join(UP, token), file.buffer);
  fs.writeFileSync(path.join(UP, token + ".json"), JSON.stringify({ name: file.originalname }));
  return token;
}
function loadUpload(token: string) {
  if (!/^[a-f0-9]{24}$/.test(token)) throw Object.assign(new Error("Arquivo de importação inválido."), { status: 400 });
  const meta = JSON.parse(fs.readFileSync(path.join(UP, token + ".json"), "utf8"));
  return { name: meta.name as string, sheets: readWorkbook(fs.readFileSync(path.join(UP, token)), meta.name) };
}
function previewSheet(sheets: ReturnType<typeof readWorkbook>, sheetName?: string, headerRow?: number) {
  const sheet = sheets.find((s) => s.name === sheetName) || sheets[0];
  const hr = headerRow ?? detectHeaderRow(sheet.rows);
  const headers = sheet.rows[hr] || [];
  return { sheet: sheet.name, header_row: hr, headers, sample: sheet.rows.slice(hr + 1, hr + 21), total_rows: Math.max(0, sheet.rows.length - hr - 1) };
}

// ---------- Importacao de lotes ----------
lots.post("/import/upload", requireRole("pesquisador"), upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  const token = saveUpload(req.file);
  const { sheets, name } = loadUpload(token);
  const p = previewSheet(sheets);
  res.json({ token, filename: name, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), ...p, mapping: suggestMapping(p.headers) });
});

lots.post("/import/preview", requireRole("pesquisador"), async (req, res) => {
  const { token, sheet, header_row, mapping } = req.body;
  const { sheets } = loadUpload(token);
  const p = previewSheet(sheets, sheet, header_row);
  const map = mapping || suggestMapping(p.headers);
  const s = sheets.find((x) => x.name === p.sheet)!;
  const parsed = parseRows(s, p.header_row, map);
  const skus = [...new Set(parsed.rows.map((r) => r.sku).filter(Boolean))];
  const known = skus.length ? await db.query<any>(`SELECT p.sku, (SELECT status FROM tech_validations t WHERE t.product_id=p.id ORDER BY version DESC LIMIT 1) AS tech_status,
      (SELECT max(created_at) FROM research_runs r WHERE r.product_id=p.id) AS last_research FROM products p WHERE p.sku = ANY($1)`, [skus]) : [];
  res.json({
    ...p, mapping: map,
    rows: parsed.rows.slice(0, 500),
    stats: {
      linhas: parsed.rows.length, skus_unicos: skus.length,
      unidades: parsed.rows.reduce((a, r) => a + (r.quantity || 0), 0),
      com_erro: parsed.rows.filter((r) => r.issues.some((i) => !i.startsWith("SKU duplicado"))).length,
      duplicados: parsed.duplicates, ja_na_base: known.length,
      ja_validados: known.filter((k) => k.tech_status === "aprovada").length,
    },
    known,
  });
});

lots.post("/import/commit", requireRole("pesquisador"), async (req, res) => {
  const { token, sheet, header_row, mapping, code, received_at, notes } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "Informe o nome ou código do lote." });
  if (mapping?.sku == null) return res.status(400).json({ error: "Mapeie a coluna de SKU." });
  if (await one(db, "SELECT 1 FROM lots WHERE code=$1", [code.trim()])) return res.status(400).json({ error: "Já existe um lote com esse código." });
  const { sheets, name } = loadUpload(token);
  const s = sheets.find((x) => x.name === sheet) || sheets[0];
  const parsed = parseRows(s, header_row, mapping);
  const valid = parsed.rows.filter((r) => r.sku);
  const lotId = await db.tx(async (q) => {
    const lot = await one(q, "INSERT INTO lots(code,received_at,source_filename,sheet_name,column_map,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [code.trim(), received_at || null, name, s.name, JSON.stringify({ header_row, mapping, headers: parsed.headers }), notes || null, req.user!.id]);
    const groups = new Map<string, { ids: number[]; qty: number; desc: string; com: string }>();
    for (const r of parsed.rows) {
      const row = await one(q, "INSERT INTO lot_raw_rows(lot_id,row_number,sku,description,quantity,raw,issues) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [lot!.id, r.row_number, r.sku || null, r.description, r.quantity, JSON.stringify(r.raw), JSON.stringify(r.issues)]);
      if (!r.sku) continue;
      const g = groups.get(r.sku) || { ids: [], qty: 0, desc: r.description, com: r.commodity };
      g.ids.push(row!.id); g.qty += r.quantity || 0; groups.set(r.sku, g);
    }
    for (const [sku, g] of groups) {
      const existing = await one(q, "SELECT id FROM products WHERE sku=$1", [sku]);
      const pid = existing?.id ?? (await one(q, "INSERT INTO products(sku,first_seen_lot_id) VALUES($1,$2) RETURNING id", [sku, lot!.id]))!.id;
      await q.query("INSERT INTO lot_items(lot_id,product_id,sku,quantity,raw_row_ids,original_description,original_commodity,existed_before) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [lot!.id, pid, sku, g.qty, g.ids, g.desc, g.com, !!existing]);
    }
    await logChange(q, { entity: "lote", entity_id: lot!.id, lot_id: lot!.id, action: "lote_importado", new_value: { arquivo: name, aba: s.name, linhas: parsed.rows.length, skus: groups.size, sem_sku: parsed.rows.length - valid.length }, user_id: req.user!.id });
    return lot!.id;
  });
  res.json({ lot_id: lotId });
});

// ---------- Lotes ----------
lots.get("/lots", async (_req, res) => {
  const rows = await db.query(`SELECT l.*, u.name AS created_by_name, (SELECT count(*)::int FROM lot_items i WHERE i.lot_id=l.id) AS skus FROM lots l LEFT JOIN users u ON u.id=l.created_by ORDER BY l.created_at DESC`);
  const out = [];
  for (const l of rows) out.push({ ...l, header: lotHeader(await lotItems(l.id)) });
  res.json(out);
});

lots.get("/lots/:id", async (req, res) => {
  const lot = await one(db, "SELECT l.*, u.name AS created_by_name FROM lots l LEFT JOIN users u ON u.id=l.created_by WHERE l.id=$1", [req.params.id]);
  if (!lot) return res.status(404).json({ error: "Lote não encontrado." });
  const items = await lotItems(lot.id);
  res.json({ lot, header: lotHeader(items), items });
});

lots.post("/lots/:id/summary", async (req, res) => {
  const items = await lotItems(Number(req.params.id), { itemIds: req.body.item_ids });
  res.json(financialSummary(items));
});

// ---------- Validacao comercial (preco) por item de lote ----------
lots.post("/items/:id/price", async (req, res) => {
  const { unit_price, status, notes, reason } = req.body;
  const st = status || "aprovada";
  if (!["rascunho", "aprovada", "revisao_solicitada"].includes(st)) return res.status(400).json({ error: "Status inválido." });
  if (st === "aprovada" && !can(req.user, "validador")) return res.status(403).json({ error: "Apenas validadores aprovam preços. Salve como rascunho." });
  if (!can(req.user, "validador", "pesquisador")) return res.status(403).json({ error: "Sem permissão para alterar preços." });
  const price = unit_price === "" || unit_price == null ? null : Number(unit_price);
  if (st === "aprovada" && (price == null || !Number.isFinite(price) || price <= 0)) return res.status(400).json({ error: "Informe um preço unitário válido para aprovar." });
  const item = await one(db, "SELECT * FROM lot_items WHERE id=$1", [req.params.id]);
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  await db.tx(async (q) => {
    const prev = await one(q, "SELECT * FROM commercial_validations WHERE lot_item_id=$1 ORDER BY version DESC LIMIT 1", [item.id]);
    const prevOk = await one(q, "SELECT unit_price FROM commercial_validations WHERE lot_item_id=$1 AND status='aprovada' ORDER BY version DESC LIMIT 1", [item.id]);
    const v = await one(q, "INSERT INTO commercial_validations(lot_item_id,version,status,unit_price,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [item.id, (prev?.version || 0) + 1, st, price, notes ?? prev?.notes ?? null, req.user!.id]);
    await logChange(q, { entity: "validacao_comercial", entity_id: v!.id, product_id: item.product_id, lot_id: item.lot_id, action: `preco_${st}`, field: "preco_unitario",
      old_value: { preco_aprovado_anterior: prevOk?.unit_price ?? null, status_anterior: prev?.status ?? null }, new_value: { preco: price, status: st }, reason: reason || null, user_id: req.user!.id });
  });
  const [it] = await lotItems(item.lot_id, { itemIds: [item.id] });
  res.json({ item: it, header: lotHeader(await lotItems(item.lot_id)) });
});

// ---------- Lenovo Parts Lookup (semiautomatico) ----------
lots.get("/lots/:id/lenovo", async (req, res) => {
  const batches = await ensureBatches(Number(req.params.id));
  const done = await db.query<{ sku: string; fetched_at: string }>(`SELECT p.sku, max(s.fetched_at) AS fetched_at FROM lot_items li JOIN products p ON p.id=li.product_id
    JOIN sources s ON s.product_id=p.id AND s.source_type='lenovo_parts_lookup' WHERE li.lot_id=$1 GROUP BY p.sku`, [req.params.id]);
  const doneMap = Object.fromEntries(done.map((d) => [d.sku, d.fetched_at]));
  res.json({ url: PARTS_LOOKUP_URL, batches: batches.map((b: any) => ({ ...b, text: b.skus.join(";"), done: b.skus.filter((s: string) => doneMap[s]).length })) });
});

lots.post("/lenovo/upload", requireRole("pesquisador"), upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  const token = saveUpload(req.file);
  const { sheets, name } = loadUpload(token);
  const p = previewSheet(sheets);
  res.json({ token, filename: name, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), ...p });
});

lots.post("/lenovo/commit", requireRole("pesquisador"), async (req, res) => {
  const { token, sheet, header_row, mapping, consulted_at } = req.body as { token: string; sheet: string; header_row: number; mapping: Record<string, number | null>; consulted_at?: string };
  if (mapping?.sku == null) return res.status(400).json({ error: "Mapeie a coluna do SKU consultado." });
  const { sheets, name } = loadUpload(token);
  const s = sheets.find((x) => x.name === sheet) || sheets[0];
  const results = new Map<string, ReturnType<typeof rowToResult>>();
  for (let i = header_row + 1; i < s.rows.length; i++) {
    const r = s.rows[i];
    const obj: Record<string, string> = {};
    for (const [k, idx] of Object.entries(mapping)) if (idx != null) obj[k] = r[idx] ?? "";
    const res1 = rowToResult(obj);
    if (!res1.sku) continue;
    const prev = results.get(res1.sku);
    if (prev) { // varias linhas por SKU (ex.: uma por maquina compativel) -> agrega
      prev.machine_types = [...new Set([...(prev.machine_types || []), ...(res1.machine_types || [])])];
      prev.substitutes = [...(prev.substitutes || []), ...(res1.substitutes || [])];
      prev.images = [...new Set([...(prev.images || []), ...(res1.images || [])])];
      prev.fru ||= res1.fru; prev.official_name ||= res1.official_name; prev.commodity ||= res1.commodity;
    } else results.set(res1.sku, res1);
  }
  const unmatched: string[] = [];
  let recorded = 0;
  await db.tx(async (q) => {
    for (const [sku, r] of results) {
      const p = await one(q, "SELECT id FROM products WHERE sku=$1", [sku]);
      if (!p) { unmatched.push(sku); continue; }
      await recordLenovoResult(q, p.id, r, { userId: req.user!.id, reference: `Arquivo "${name}" importado (Lenovo Parts Lookup)`, fetchedAt: consulted_at || undefined });
      recorded++;
    }
  });
  res.json({ recorded, unmatched });
});
