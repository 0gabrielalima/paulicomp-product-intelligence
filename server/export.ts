// Exportacao Excel (abas completas, links clicaveis, moedas originais) e CSV.
import { Router } from "express";
import ExcelJS from "exceljs";
import { db, one } from "./db.ts";
import { lotItems, financialSummary, listingsFor, type Item } from "./views.ts";
import { groupStats } from "./calc.ts";

export const exportRoutes = Router();

const STATUS: Record<string, string> = { aprovada: "Aprovada", rascunho: "Rascunho", revisao_solicitada: "Revisão solicitada", pendente: "Pendente", nao_identificado: "Não identificado" };

async function selectItems(lotId: number, scope: string, ids?: number[]) {
  let items = await lotItems(lotId, ids?.length ? { itemIds: ids } : {});
  if (scope === "aprovados") items = items.filter((i) => i.approved_price != null);
  if (scope === "pendentes") items = items.filter((i) => i.approved_price == null);
  return items;
}

function sheet(wb: ExcelJS.Workbook, name: string, cols: { header: string; key: string; width?: number; fmt?: string }[], rows: Record<string, any>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || 16, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  for (const r of rows) {
    const row = ws.addRow(r);
    for (const c of cols) {
      const v = r[c.key];
      if (typeof v === "string" && /^https?:\/\//.test(v)) row.getCell(c.key).value = { text: v, hyperlink: v } as any, (row.getCell(c.key).font = { color: { argb: "FF1D4ED8" }, underline: true });
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
const BRL = '"R$" #,##0.00';
const d = (v: any) => (v ? new Date(v) : null);

exportRoutes.get("/lots/:id/export.xlsx", async (req, res) => {
  const lotId = Number(req.params.id);
  const lot = await one(db, "SELECT * FROM lots WHERE id=$1", [lotId]);
  if (!lot) return res.status(404).json({ error: "Lote não encontrado." });
  const scope = String(req.query.scope || "completo");
  const ids = req.query.ids ? String(req.query.ids).split(",").map(Number).filter(Boolean) : undefined;
  const items = await selectItems(lotId, scope, ids);
  const pids = items.map((i) => i.product_id);
  const itemByPid = new Map(items.map((i) => [i.product_id, i]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "PAULICOMP | Product Intelligence";

  // 1. Dados originais (todas as colunas da planilha, exatamente como recebidas)
  const raw = items.length ? await db.query("SELECT * FROM lot_raw_rows WHERE lot_id=$1 AND sku = ANY($2) ORDER BY row_number", [lotId, items.map((i) => i.sku)]) : [];
  const rawHeaders: string[] = lot.column_map?.headers?.length ? lot.column_map.headers : [...new Set(raw.flatMap((r) => Object.keys(r.raw)))];
  sheet(wb, "Dados originais", [{ header: "Linha", key: "_linha", width: 8 }, ...rawHeaders.map((h) => ({ header: h, key: h, width: 22 }))],
    raw.map((r) => ({ _linha: r.row_number, ...r.raw })));

  // 2. Pesquisa tecnica
  const facts = pids.length ? await db.query(`SELECT tf.*, s.url, s.reference, s.source_type, s.fetched_at FROM tech_facts tf LEFT JOIN sources s ON s.id=tf.source_id WHERE tf.product_id = ANY($1) ORDER BY tf.product_id, tf.field`, [pids]) : [];
  const codes = pids.length ? await db.query(`SELECT pc.*, s.url, s.reference, s.fetched_at FROM product_codes pc LEFT JOIN sources s ON s.id=pc.source_id WHERE pc.product_id = ANY($1) ORDER BY pc.product_id`, [pids]) : [];
  sheet(wb, "Pesquisa técnica", [
    { header: "SKU", key: "sku" }, { header: "Tipo", key: "tipo", width: 14 }, { header: "Campo / código", key: "campo", width: 30 }, { header: "Valor", key: "valor", width: 50 },
    { header: "Confirmação", key: "conf" }, { header: "Fonte", key: "fonte", width: 30 }, { header: "Link", key: "url", width: 40 }, { header: "Data da consulta", key: "data", width: 20, fmt: "dd/mm/yyyy hh:mm" },
  ], [
    ...codes.map((c) => ({ sku: itemByPid.get(c.product_id)?.sku, tipo: "Código", campo: c.code_type, valor: c.code, conf: c.confirmation, fonte: c.reference, url: c.url, data: d(c.fetched_at) })),
    ...facts.map((f) => ({ sku: itemByPid.get(f.product_id)?.sku, tipo: "Especificação", campo: f.field, valor: f.value, conf: f.confirmation, fonte: f.reference || f.source_type, url: f.url, data: d(f.fetched_at) })),
  ]);

  // 3. Compatibilidades (lista completa, sem resumo)
  const compat = pids.length ? await db.query(`SELECT c.*, s.url, s.reference FROM compatibilities c LEFT JOIN sources s ON s.id=c.source_id WHERE c.product_id = ANY($1) ORDER BY c.product_id, c.machine_type, c.model`, [pids]) : [];
  sheet(wb, "Compatibilidades", [
    { header: "SKU", key: "sku" }, { header: "Marca", key: "brand" }, { header: "Linha", key: "line" }, { header: "Família", key: "family" }, { header: "Modelo", key: "model", width: 28 },
    { header: "Machine Type", key: "machine_type" }, { header: "Código da máquina", key: "machine_code" }, { header: "Tipo de confirmação", key: "confirmation", width: 22 }, { header: "Fonte", key: "reference", width: 30 }, { header: "Link", key: "url", width: 40 }, { header: "Observações", key: "notes", width: 30 },
  ], compat.map((c) => ({ ...c, sku: itemByPid.get(c.product_id)?.sku })));

  // 4-6. Mercado
  const ls = await listingsFor(db, pids);
  const listingRows = (pred: (l: any) => boolean) => pids.flatMap((pid) => {
    const all = ls.get(pid) || [];
    const st = groupStats(all);
    return all.filter(pred).map((l: any) => ({
      sku: itemByPid.get(pid)?.sku, ...l, collected_at: d(l.collected_at), fx_at: d(l.fx_at),
      participa: st.listings[l.id]?.included ? "Sim" : "Não", motivo: st.listings[l.id]?.reason || "", propria: l.is_own ? "Sim" : "Não",
    }));
  });
  const baseCols = [
    { header: "SKU", key: "sku" }, { header: "Loja", key: "store" }, { header: "Marketplace", key: "marketplace" }, { header: "Vendedor", key: "seller" }, { header: "Título original", key: "title", width: 45 },
    { header: "SKU informado", key: "sku_informed" }, { header: "PN informado", key: "pn_informed" },
  ];
  const tailCols = [
    { header: "Condição", key: "condition" }, { header: "Originalidade", key: "originality" }, { header: "Versão", key: "commercial_version" }, { header: "Disponibilidade", key: "availability" },
    { header: "Qtd disponível", key: "qty_available" }, { header: "Qtd vendida", key: "qty_sold" }, { header: "Prazo/entrega", key: "delivery" }, { header: "Correspondência", key: "match_type", width: 22 }, { header: "Evidência", key: "match_evidence", width: 30 },
    { header: "Origem do preço", key: "price_origin" }, { header: "Anúncio próprio", key: "propria" }, { header: "Participa do cálculo", key: "participa" }, { header: "Motivo", key: "motivo", width: 30 },
    { header: "Link", key: "url", width: 45 }, { header: "Consultado em", key: "collected_at", width: 18, fmt: "dd/mm/yyyy hh:mm" }, { header: "Observações", key: "notes", width: 30 },
  ];
  sheet(wb, "Mercado nacional", [...baseCols, { header: "Preço à vista", key: "price_original", fmt: BRL }, { header: "Parcela", key: "price_installment", fmt: BRL }, { header: "Nº parcelas", key: "installments" }, { header: "Frete", key: "shipping", fmt: BRL }, ...tailCols],
    listingRows((l) => l.market === "nacional" && l.competition === "direta"));
  sheet(wb, "Mercado internacional", [...baseCols, { header: "País", key: "country" }, { header: "Título traduzido", key: "title_translated", width: 40 }, { header: "Moeda", key: "currency" }, { header: "Valor original", key: "price_original", fmt: "#,##0.00" },
    { header: "Taxa de câmbio", key: "fx_rate", fmt: "0.0000" }, { header: "Fonte da cotação", key: "fx_source", width: 22 }, { header: "Data da cotação", key: "fx_at", fmt: "dd/mm/yyyy hh:mm" }, { header: "Convertido (BRL)", key: "price_brl", fmt: BRL },
    { header: "Frete internacional", key: "shipping", fmt: "#,##0.00" }, { header: "Tributos", key: "taxes", fmt: "#,##0.00" }, ...tailCols],
    listingRows((l) => l.market === "internacional" && l.competition === "direta"));
  sheet(wb, "Concorrência indireta", [...baseCols, { header: "Mercado", key: "market" }, { header: "Moeda", key: "currency" }, { header: "Valor original", key: "price_original", fmt: "#,##0.00" }, { header: "Convertido (BRL)", key: "price_brl", fmt: BRL }, ...tailCols],
    listingRows((l) => l.competition === "indireta"));

  // 7. Analise da IA
  const ai = pids.length ? await db.query(`SELECT DISTINCT ON (product_id) * FROM ai_consolidations WHERE product_id = ANY($1) ORDER BY product_id, created_at DESC`, [pids]) : [];
  sheet(wb, "Análise da IA", [{ header: "SKU", key: "sku" }, { header: "Versão", key: "version" }, { header: "Modelo", key: "model" }, { header: "Data", key: "created_at", fmt: "dd/mm/yyyy hh:mm" }, { header: "Nome comercial", key: "nome", width: 35 }, { header: "Preço sugerido", key: "preco", fmt: BRL }, { header: "Justificativa", key: "just", width: 60 }, { header: "Saída completa (JSON)", key: "json", width: 80 }],
    ai.map((a) => ({ sku: itemByPid.get(a.product_id)?.sku, version: a.version, model: a.model, created_at: d(a.created_at), nome: a.output?.nome_comercial, preco: a.output?.precificacao?.preco_sugerido, just: a.output?.precificacao?.justificativa, json: JSON.stringify(a.output) })));

  // 8. Dados validados + financeiro por SKU
  const tv = pids.length ? await db.query(`SELECT DISTINCT ON (product_id) t.*, u.name AS user_name FROM tech_validations t LEFT JOIN users u ON u.id=t.created_by WHERE product_id = ANY($1) ORDER BY product_id, version DESC`, [pids]) : [];
  const tvBy = new Map(tv.map((t) => [t.product_id, t]));
  sheet(wb, "Dados validados", [
    { header: "SKU", key: "sku" }, { header: "Nome comercial", key: "nome", width: 35 }, { header: "Categoria", key: "category", width: 20 }, { header: "Marca", key: "marca" }, { header: "Modelo", key: "modelo" }, { header: "Part Number", key: "pn" }, { header: "FRU", key: "fru" },
    { header: "Quantidade recebida", key: "quantity", fmt: "#,##0" }, { header: "Preço unitário IA", key: "ai_price", fmt: BRL }, { header: "Preço unitário validado", key: "approved_price", fmt: BRL },
    { header: "Valor total sugerido", key: "total_ai", fmt: BRL }, { header: "Valor total validado", key: "total_validated", fmt: BRL }, { header: "Status comercial", key: "com", width: 18 },
    { header: "Validação técnica", key: "tech", width: 18 }, { header: "Validado por", key: "by" }, { header: "Título", key: "titulo", width: 40 }, { header: "Descrição", key: "descricao", width: 60 }, { header: "Observações internas", key: "obs", width: 40 },
  ], items.map((i) => { const t = tvBy.get(i.product_id)?.data || {}; return {
    sku: i.sku, nome: i.name, category: i.category, marca: t.marca, modelo: t.modelo, pn: t.part_number, fru: i.fru, quantity: i.quantity, ai_price: i.ai_price, approved_price: i.approved_price,
    total_ai: i.total_ai, total_validated: i.total_validated, com: i.approved_price != null ? "Aprovada" : STATUS[i.com_status] || i.com_status, tech: STATUS[i.tech_status] || i.tech_status, by: i.validator, titulo: t.titulo, descricao: t.descricao, obs: t.observacoes,
  }; }));

  // 9. Historico de alteracoes
  const hist = await db.query(`SELECT h.*, u.name AS user_name, p.sku FROM change_log h LEFT JOIN users u ON u.id=h.user_id LEFT JOIN products p ON p.id=h.product_id WHERE h.lot_id=$1 OR h.product_id = ANY($2) ORDER BY h.created_at`, [lotId, pids]);
  sheet(wb, "Histórico de alterações", [{ header: "Data", key: "created_at", width: 18, fmt: "dd/mm/yyyy hh:mm" }, { header: "Usuário", key: "user_name" }, { header: "SKU", key: "sku" }, { header: "Ação", key: "action", width: 26 }, { header: "Campo", key: "field" }, { header: "Anterior", key: "old", width: 40 }, { header: "Novo", key: "new", width: 40 }, { header: "Motivo", key: "reason", width: 30 }],
    hist.map((h) => ({ ...h, created_at: d(h.created_at), old: h.old_value == null ? "" : JSON.stringify(h.old_value), new: h.new_value == null ? "" : JSON.stringify(h.new_value) })));

  // Resumo financeiro por categoria
  const fs = financialSummary(items);
  const byCat = new Map<string, Item[]>();
  for (const i of items) { const k = i.category || "Sem categoria"; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k)!.push(i); }
  const ws = sheet(wb, "Resumo financeiro", [{ header: "Categoria", key: "cat", width: 28 }, { header: "SKUs", key: "skus" }, { header: "Unidades", key: "units", fmt: "#,##0" }, { header: "Unidades c/ preço aprovado", key: "units_approved", fmt: "#,##0" },
    { header: "Unidades pendentes", key: "units_pending", fmt: "#,##0" }, { header: "Potencial validado", key: "potential_validated", width: 20, fmt: BRL }, { header: "Potencial sugerido IA", key: "potential_ai", width: 20, fmt: BRL }, { header: "% unidades validadas", key: "pct_units_approved", fmt: '0.00"%"' }],
    [...[...byCat].sort().map(([cat, xs]) => ({ cat, ...financialSummary(xs) })), { cat: "TOTAL DO LOTE", ...fs }]);
  ws.lastRow!.font = { bold: true };
  ws.addRow([]);
  ws.addRow(["Valor potencial = quantidade × preço unitário aprovado. Potencial de faturamento bruto; não representa faturamento realizado, lucro ou margem. Itens pendentes não entram no potencial validado."]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`lote-${lot.code}-${scope}.xlsx`)}"`);
  await wb.xlsx.write(res);
  res.end();
});

exportRoutes.get("/lots/:id/export.csv", async (req, res) => {
  const lotId = Number(req.params.id);
  const lot = await one(db, "SELECT code FROM lots WHERE id=$1", [lotId]);
  if (!lot) return res.status(404).json({ error: "Lote não encontrado." });
  const ids = req.query.ids ? String(req.query.ids).split(",").map(Number).filter(Boolean) : undefined;
  const items = await selectItems(lotId, String(req.query.scope || "completo"), ids);
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (v: any) => (v == null ? "" : String(v).replace(".", ","));
  const head = ["SKU", "Nome comercial", "Categoria", "Nomenclatura Lenovo", "Quantidade recebida", "Preço unitário IA", "Preço unitário validado", "Valor total sugerido", "Valor total validado", "Status comercial", "Validação técnica", "Status da pesquisa"];
  const lines = items.map((i) => [i.sku, i.name, i.category, i.original_description, num(i.quantity), num(i.ai_price), num(i.approved_price), num(i.total_ai), num(i.total_validated), i.approved_price != null ? "Aprovada" : i.com_status, i.tech_status, i.research_status].map(esc).join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`lote-${lot.code}.csv`)}"`);
  res.send("﻿" + [head.join(";"), ...lines].join("\r\n"));
});
