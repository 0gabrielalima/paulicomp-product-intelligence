// Leitura de XLS/XLSX/CSV preservando codigos como texto (zeros a esquerda, alfanumericos).
import * as XLSX from "xlsx";

export type Sheet = { name: string; rows: string[][]; rawRows: unknown[][] };

export function readWorkbook(buf: Buffer, filename: string): Sheet[] {
  const isCsv = /\.(csv|txt)$/i.test(filename);
  // CSV: raw=true impede o parser de converter "00123" em numero
  const wb = XLSX.read(buf, isCsv ? { type: "buffer", raw: true, codepage: 65001 } : { type: "buffer", cellText: true, cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const text = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: false }) as string[][];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][];
    return { name, rows: text.map((r) => r.map((c) => String(c ?? "").trim())), rawRows: raw };
  });
}

const HINTS: Record<string, RegExp> = {
  sku: /^(material|sku|part ?(number|no|n[ºo°])?|pn|fru|c[oó]digo|codigo|item)$/i,
  description: /(desc|nomenclatura|nome|descri)/i,
  quantity: /^(qty|qtd|qtde|quant|quantidade|quantity)/i,
  commodity: /(commodity|categoria|tipo|family|fam[ií]lia)/i,
};

export function detectHeaderRow(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const hits = r.filter((c) => Object.values(HINTS).some((h) => h.test(c))).length;
    if (hits >= 2) return i;
  }
  return 0;
}

export function suggestMapping(headers: string[]) {
  const m: Record<string, number | null> = { sku: null, description: null, quantity: null, commodity: null };
  for (const k of Object.keys(m)) {
    const idx = headers.findIndex((h) => HINTS[k].test(h));
    m[k] = idx >= 0 ? idx : null;
  }
  return m;
}

/** Converte quantidade aceitando 1234 / 1.234 / 1,5 / 1.234,50. */
export function parseQty(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** SKU sempre como texto; para celulas numericas do Excel usa o texto formatado (mantem zeros de formato). */
export function cleanSku(text: string) {
  return text.replace(/\s+/g, "").toUpperCase();
}

export type ParsedRow = { row_number: number; sku: string; description: string; quantity: number | null; commodity: string; raw: Record<string, string>; issues: string[] };

export function parseRows(sheet: Sheet, headerRow: number, map: Record<string, number | null>) {
  const headers = sheet.rows[headerRow] || [];
  const out: ParsedRow[] = [];
  for (let i = headerRow + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (!r || r.every((c) => !c)) continue;
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { raw[h || `Coluna ${j + 1}`] = r[j] ?? ""; });
    for (let j = headers.length; j < r.length; j++) if (r[j]) raw[`Coluna ${j + 1}`] = r[j];
    const issues: string[] = [];
    const sku = map.sku != null ? cleanSku(r[map.sku] ?? "") : "";
    if (!sku) issues.push("SKU vazio");
    const rawQty = map.quantity != null ? sheet.rawRows[i]?.[map.quantity] ?? r[map.quantity] : null;
    const quantity = map.quantity != null ? parseQty(rawQty) : null;
    if (map.quantity != null && quantity == null) issues.push("Quantidade inválida ou vazia");
    if (quantity != null && quantity < 0) issues.push("Quantidade negativa");
    out.push({
      row_number: i + 1, sku, quantity,
      description: map.description != null ? r[map.description] ?? "" : "",
      commodity: map.commodity != null ? r[map.commodity] ?? "" : "",
      raw, issues,
    });
  }
  const count: Record<string, number> = {};
  for (const x of out) if (x.sku) count[x.sku] = (count[x.sku] || 0) + 1;
  for (const x of out) if (x.sku && count[x.sku] > 1) x.issues.push(`SKU duplicado (${count[x.sku]} linhas) — será pesquisado uma única vez, quantidades somadas`);
  return { headers, rows: out, duplicates: Object.entries(count).filter(([, n]) => n > 1).map(([sku, n]) => ({ sku, n })) };
}
