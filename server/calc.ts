// Calculos deterministicos (estatistica, cambio, valor potencial). Nunca delegados ao modelo de IA.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function quantile(xs: number[], q: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const DIRECT_MATCHES = ["sku_exato", "codigo_equivalente_oficial", "mesmo_modelo"];
export const HISTORIC_AVAIL = ["esgotado", "vendido", "encerrado", "indisponivel"];
export const AVAILABLE = ["disponivel", "sob_encomenda"];

export type Listing = {
  id: number; market: string; competition: string; match_type: string; availability: string; is_own: boolean; excluded: boolean;
  exclusion_reason?: string | null; price_original: number | null; price_installment: number | null; installments: number | null;
  price_brl: number | null; currency: string; excluded_by?: number | null; seller: string | null; store: string | null; marketplace: string | null;
  condition: string; originality: string; commercial_version: string; price_origin: string;
};

export type Group = "nacional_direta" | "internacional_direta" | "indireta" | "historico" | "propria";
export const GROUP_LABEL: Record<Group, string> = {
  nacional_direta: "Concorrência nacional direta",
  internacional_direta: "Concorrência internacional direta",
  indireta: "Concorrência indireta",
  historico: "Anúncios históricos",
  propria: "Anúncios próprios Paulicomp",
};

export function groupOf(l: Listing): Group {
  if (l.is_own) return "propria";
  if (HISTORIC_AVAIL.includes(l.availability)) return "historico";
  if (l.competition === "indireta") return "indireta";
  return l.market === "internacional" ? "internacional_direta" : "nacional_direta";
}

/** Preco em BRL usado no calculo (a vista por padrao; parcelado = valor total parcelado). */
export function priceFor(l: Listing, mode: "avista" | "parcelado"): number | null {
  if (l.market === "internacional" || l.currency !== "BRL") return l.price_brl ?? null;
  if (mode === "parcelado") {
    if (l.price_installment != null && l.installments) return l.price_installment * l.installments;
    return l.price_original;
  }
  return l.price_original;
}

/** Motivo pelo qual o anuncio NAO participa do calculo do grupo (null = participa). */
export function exclusionReason(l: Listing, g: Group, price: number | null): string | null {
  if (l.excluded) return `${l.excluded_by ? "Excluído manualmente" : "Desconsiderado automaticamente"}${l.exclusion_reason ? `: ${l.exclusion_reason}` : ""}`;
  if (l.match_type === "incompativel") return "Produto incompatível";
  if (price == null) return l.market === "internacional" && l.price_original != null ? "Sem conversão cambial" : "Anúncio sem preço";
  if (g === "historico") return "Anúncio histórico (não é concorrência ativa)";
  if (g === "propria") return "Anúncio da própria Paulicomp";
  if ((g === "nacional_direta" || g === "internacional_direta") && !DIRECT_MATCHES.includes(l.match_type))
    return "Correspondência não confirmada para concorrência direta";
  return null;
}

export type StatsFilter = { mode?: "avista" | "parcelado"; condition?: string; originality?: string; availability?: string; version?: string; match_type?: string };

export function groupStats(all: Listing[], f: StatsFilter = {}) {
  const mode = f.mode || "avista";
  const out: Record<string, any> = {};
  const used: Record<number, { group: Group; included: boolean; reason: string | null; price: number | null }> = {};
  for (const g of Object.keys(GROUP_LABEL) as Group[]) {
    const ls = all.filter((l) => groupOf(l) === g);
    const filtered = ls.filter((l) =>
      (!f.condition || l.condition === f.condition) && (!f.originality || l.originality === f.originality) &&
      (!f.availability || l.availability === f.availability) && (!f.version || l.commercial_version === f.version) &&
      (!f.match_type || l.match_type === f.match_type));
    const prices: number[] = [];
    const sellers = new Set<string>();
    let available = 0;
    for (const l of filtered) {
      const p = priceFor(l, mode);
      const reason = exclusionReason(l, g, p);
      // historico/propria: estatistica do proprio grupo (apenas referencia), nunca entra na concorrencia
      const included = g === "historico" || g === "propria"
        ? p != null && !l.excluded && l.match_type !== "incompativel"
        : reason === null;
      used[l.id] = { group: g, included, reason, price: p };
      if (included && p != null) {
        prices.push(p);
        sellers.add((l.seller || l.store || l.marketplace || "?").toLowerCase());
      }
      if (AVAILABLE.includes(l.availability)) available++;
    }
    const med = median(prices);
    out[g] = {
      label: GROUP_LABEL[g],
      encontrados: ls.length,
      no_filtro: filtered.length,
      comparaveis: prices.length,
      disponiveis: available,
      vendedores: sellers.size,
      menor: prices.length ? round2(Math.min(...prices)) : null,
      maior: prices.length ? round2(Math.max(...prices)) : null,
      media: prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      mediana: med == null ? null : round2(med),
      p25: prices.length ? round2(quantile(prices, 0.25)!) : null,
      p75: prices.length ? round2(quantile(prices, 0.75)!) : null,
      distribuicao: histogram(prices),
    };
  }
  return { mode, groups: out, listings: used };
}

function histogram(xs: number[], bins = 6) {
  if (xs.length < 2) return xs.map((x) => ({ de: round2(x), ate: round2(x), n: 1 }));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (lo === hi) return [{ de: round2(lo), ate: round2(hi), n: xs.length }];
  const w = (hi - lo) / bins;
  const b = Array.from({ length: bins }, (_, i) => ({ de: round2(lo + i * w), ate: round2(lo + (i + 1) * w), n: 0 }));
  for (const x of xs) b[Math.min(bins - 1, Math.floor((x - lo) / w))].n++;
  return b;
}

/** Discrepancia: preco fora de [Q1 - 1.5*IQR, Q3 + 1.5*IQR] dentro do proprio grupo. Apenas sinaliza, nunca exclui. */
export function outlierIds(all: Listing[], mode: "avista" | "parcelado" = "avista") {
  const ids = new Set<number>();
  for (const g of Object.keys(GROUP_LABEL) as Group[]) {
    const ls = all.filter((l) => groupOf(l) === g).map((l) => ({ id: l.id, p: priceFor(l, mode) })).filter((x) => x.p != null) as { id: number; p: number }[];
    if (ls.length < 4) continue;
    const q1 = quantile(ls.map((x) => x.p), 0.25)!, q3 = quantile(ls.map((x) => x.p), 0.75)!;
    const iqr = q3 - q1;
    for (const x of ls) if (x.p < q1 - 1.5 * iqr || x.p > q3 + 1.5 * iqr) ids.add(x.id);
  }
  return ids;
}

export type Level = "alta" | "media" | "baixa" | "insuficiente";

/** Confianca comercial deterministica (complementa, nao substitui, a avaliacao da IA). */
export function commercialConfidence(stats: ReturnType<typeof groupStats>): { level: Level; reasons: string[] } {
  const n = stats.groups.nacional_direta, i = stats.groups.internacional_direta;
  const reasons: string[] = [];
  const total = n.comparaveis + i.comparaveis;
  if (!total) return { level: "insuficiente", reasons: ["Nenhum anúncio direto comparável com preço."] };
  reasons.push(`${n.comparaveis} anúncio(s) nacional(is) e ${i.comparaveis} internacional(is) comparáveis.`);
  const ref = n.comparaveis ? n : i;
  const disp = ref.mediana && ref.p25 != null && ref.p75 != null ? (ref.p75 - ref.p25) / ref.mediana : null;
  if (disp != null) reasons.push(`Dispersão interquartil de ${Math.round(disp * 100)}% da mediana.`);
  if (!n.comparaveis) reasons.push("Sem concorrência nacional direta comparável.");
  let level: Level = "baixa";
  if (n.comparaveis >= 5 && n.vendedores >= 3 && (disp ?? 1) < 0.35) level = "alta";
  else if (total >= 3) level = "media";
  return { level, reasons };
}

export function technicalConfidence(x: { officialCodes: number; officialFacts: number; otherFacts: number; validated: boolean }): { level: Level; reasons: string[] } {
  const r: string[] = [];
  if (x.validated) r.push("Identificação técnica aprovada por colaborador.");
  if (x.officialCodes) r.push(`${x.officialCodes} código(s) confirmados em fonte oficial Lenovo.`);
  if (x.officialFacts) r.push(`${x.officialFacts} especificação(ões) de fonte oficial.`);
  if (x.otherFacts) r.push(`${x.otherFacts} especificação(ões) de fontes complementares.`);
  if (!r.length) return { level: "insuficiente", reasons: ["Nenhuma fonte consultada ainda; apenas a nomenclatura original."] };
  const level: Level = x.validated || (x.officialCodes && x.officialFacts) ? "alta" : x.officialCodes ? "media" : x.otherFacts ? "baixa" : "insuficiente";
  return { level, reasons: r };
}

export function compatConfidence(counts: Record<string, number>): { level: Level; reasons: string[] } {
  const off = (counts.oficial_sku || 0), mod = counts.oficial_modelo || 0, other = (counts.tecnica_generica || 0) + (counts.fonte_complementar || 0) + (counts.necessita_validacao || 0);
  if (!off && !mod && !other) return { level: "insuficiente", reasons: ["Nenhuma compatibilidade registrada."] };
  const r = [`${off} confirmada(s) oficialmente para o SKU, ${mod} pelo modelo comercial, ${other} de outras fontes.`];
  return { level: off ? "alta" : mod ? "media" : "baixa", reasons: r };
}
