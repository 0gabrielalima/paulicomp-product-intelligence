import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, any>;
export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
interface Driver extends Q {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  kind: "postgres" | "pglite";
}

let driver: Driver;

async function makeDriver(): Promise<Driver> {
  if (process.env.DATABASE_URL) {
    const pg = (await import("pg")).default;
    // NUMERIC como string por padrao no pg -> converte para number
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
    pg.types.setTypeParser(20, (v: string) => Number(v));
    pg.types.setTypeParser(1082, (v: string) => v); // DATE como texto
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    return {
      kind: "postgres",
      async query(sql, params) { return (await pool.query(sql, params as any[])).rows; },
      async exec(sql) { await pool.query(sql); },
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const r = await fn({ query: async (s, p) => (await c.query(s, p as any[])).rows });
          await c.query("COMMIT");
          return r;
        } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
      },
    };
  }
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dataRoot = path.resolve(here, "..", "data");
  // ACTIVE_DB guarda o nome da pasta em uso (muda quando um backup e restaurado)
  const activeFile = path.join(dataRoot, "ACTIVE_DB");
  const dir = path.join(dataRoot, fs.existsSync(activeFile) ? fs.readFileSync(activeFile, "utf8").trim() || "pgdata" : "pgdata");
  const backups = path.join(dataRoot, "backups");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
  const opts = { parsers: { [types.NUMERIC]: (v: string) => Number(v), [types.INT8]: (v: string) => Number(v), [types.DATE]: (v: string) => v } };
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // O banco embutido pode corromper se o processo for encerrado a forca no meio de uma gravacao.
  // Protecao: (1) desligamento seguro, (2) backup automatico periodico, (3) restauracao automatica do ultimo backup.
  let db: InstanceType<typeof PGlite>;
  try {
    db = await PGlite.create(dir, opts);
  } catch (e) {
    const latest = fs.readdirSync(backups).filter((f) => f.endsWith(".tar.gz")).sort().pop();
    if (!latest) throw new Error(`Banco embutido não abriu e não há backup em ${backups}. Erro: ${(e as Error).message}`);
    // no Windows a pasta com problema fica travada por este processo: restaura numa pasta nova e passa a usa-la
    const fresh = `pgdata-${stamp()}`;
    console.error(`[banco] Banco em ${dir} não abriu (${(e as Error).message}). Restaurando backup ${latest} em data/${fresh}…`);
    const blob = new Blob([fs.readFileSync(path.join(backups, latest))]);
    db = await PGlite.create(path.join(dataRoot, fresh), { ...opts, loadDataDir: blob });
    fs.writeFileSync(activeFile, fresh);
    console.error(`[banco] Restaurado a partir de ${latest}. Alterações posteriores a esse backup foram perdidas. A pasta antiga pode ser apagada.`);
  }
  // PGlite e de conexao unica: serializa transacoes para nao intercalar comandos
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  const backup = () => serial(async () => {
    const file = await db.dumpDataDir("gzip");
    const name = path.join(backups, `pgdata-${stamp()}.tar.gz`);
    fs.writeFileSync(name, Buffer.from(await file.arrayBuffer()));
    const all = fs.readdirSync(backups).filter((f) => f.endsWith(".tar.gz")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(backups, old));
  }).catch((e) => console.error("[banco] Falha no backup:", e));
  await backup();
  setInterval(backup, 10 * 60_000).unref();
  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return; closing = true;
    console.log(`[banco] ${sig}: fechando o banco com segurança…`);
    try { await serial(() => db.close()); } finally { process.exit(0); }
  };
  for (const s of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(s, () => void shutdown(s));
  return {
    kind: "pglite",
    query: (sql, params) => serial(async () => (await db.query(sql, params as any[])).rows as any),
    exec: (sql) => serial(async () => { await db.exec(sql); }),
    tx: (fn) => serial(() => db.transaction(async (t) => fn({ query: async (s, p) => (await t.query(s, p as any[])).rows as any }))),
  };
}

export const db: Q & { tx: Driver["tx"] } = {
  query: (s, p) => driver.query(s, p),
  tx: (fn) => driver.tx(fn),
};
export const one = async <T extends Row = Row>(q: Q, sql: string, params?: unknown[]) => (await q.query<T>(sql, params))[0];

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string) {
  const [salt, h] = stored.split(":");
  const a = Buffer.from(h, "hex");
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Categorias iniciais e campos tecnicos (editaveis depois em Configuracoes)
const CATEGORIES: { code: string; name: string; fields: string[]; aliases: string[] }[] = [
  { code: "tela", name: "Tela", fields: ["Tamanho", "Resolução", "Tipo de painel", "Quantidade de pinos", "Posição do conector", "Interface", "Taxa de atualização", "Touchscreen", "Acabamento", "Fixação", "Fabricante do painel"], aliases: ["LCD", "DISPLAY", "PANEL"] },
  { code: "placa_mae", name: "Placa-mãe", fields: ["Processador", "Geração", "GPU", "VRAM", "Memória integrada", "Chipset", "Modelo da placa", "Revisão", "FRUs relacionados"], aliases: ["PLANAR", "BDPLANAR", "MOTHERBOARD", "SYSTEM BOARD"] },
  { code: "ssd", name: "SSD", fields: ["Capacidade", "Formato", "Interface", "Protocolo", "Geração PCIe", "Lanes", "Leitura", "Gravação", "NAND", "Durabilidade (TBW)", "Variante de segurança", "Código do fabricante", "Fabricante"], aliases: ["SSD"] },
  { code: "hd", name: "HD", fields: ["Capacidade", "Formato", "Interface", "Rotação", "Cache", "Código do fabricante", "Fabricante"], aliases: ["HDD", "HDD_ASM"] },
  { code: "processador", name: "Processador", fields: ["Fabricante", "Modelo", "Geração", "Arquitetura", "Núcleos", "Threads", "Frequência base", "Frequência turbo", "Cache", "Socket", "Potência base", "Potência máxima", "Vídeo integrado", "Versão (BOX/TRAY/OEM)"], aliases: ["CPU", "SP"] },
  { code: "memoria", name: "Memória", fields: ["Capacidade", "Tipo", "Frequência", "Formato", "Rank/Organização", "ECC/Registrada", "Código do fabricante", "Fabricante"], aliases: ["MEMORY"] },
  { code: "teclado", name: "Teclado", fields: ["Idioma", "Layout", "Cor", "Retroiluminação", "Teclado numérico", "Moldura", "Tipo de conexão"], aliases: ["KEYBOARD"] },
  { code: "carcaca", name: "Carcaça / Gabinete", fields: ["Parte (A/B/C/D)", "Cor", "Material", "Modelo compatível"], aliases: ["SHELL", "CHASSIS", "MECHANICAL", "MECH_ASM", "AIRDUCT", "PAD"] },
  { code: "dissipador", name: "Dissipador / Cooler", fields: ["Tipo", "Plataforma (UMA/discreta)", "Ventoinha incluída", "Fabricante"], aliases: ["HEAT SINK", "HEATSINK", "FAN"] },
  { code: "fonte", name: "Fonte / Adaptador", fields: ["Potência", "Tensão", "Eficiência", "Conector", "Fabricante"], aliases: ["PWR_SUPPLY", "POWER SUPPLY", "ADAPTER", "LINECORD"] },
  { code: "placa_rede", name: "Placa de rede / Comunicação", fields: ["Velocidade", "Portas", "Interface", "Chipset", "Formato"], aliases: ["NETWRK_CRD", "NETWORKING CARD", "COMMUNICATION CARD", "WLAN", "SWITCH"] },
  { code: "placa_video", name: "Placa de vídeo", fields: ["GPU", "VRAM", "Tipo de memória", "Interface", "Saídas", "Altura (perfil)", "Fabricante"], aliases: ["VIDEO CARD", "GPU"] },
  { code: "raid", name: "Controladora RAID", fields: ["Modelo", "Interface", "Cache", "Níveis RAID", "Portas"], aliases: ["RAID_CARD"] },
  { code: "placa_auxiliar", name: "Placa auxiliar", fields: ["Função", "Conectores", "Modelo compatível"], aliases: ["CARDPOP", "SUB CARD"] },
  { code: "cabo", name: "Cabo", fields: ["Tipo", "Conectores", "Comprimento"], aliases: ["CABLE"] },
  { code: "bateria", name: "Bateria", fields: ["Capacidade (Wh)", "Células", "Tensão", "Química", "Fabricante"], aliases: ["BATTERY"] },
  { code: "kit_servico", name: "Kit / Opcional", fields: ["Conteúdo"], aliases: ["ECAT_TLA"] },
  { code: "outros", name: "Outros", fields: [], aliases: [] },
];

const DEFAULT_SETTINGS: Record<string, unknown> = {
  validade: { tecnica_dias: null, comercial_dias: 30, cambio: "a_cada_pesquisa" },
  limites: { custo_mensal_usd: 100, custo_por_lote_usd: 50, max_buscas_web_por_sku: 8, max_anuncios_por_pesquisa: 30, concorrencia_worker: 2 },
  proprios: { dominios: [], urls: [], vendedores: [], contas_marketplace: [], nomes: ["Paulicomp", "PAULICOMP"] },
};

export async function initDb() {
  driver = await makeDriver();
  await driver.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));
  for (const c of CATEGORIES) {
    const r = await one(db, `INSERT INTO categories(code,name,fields) VALUES($1,$2,$3)
      ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code RETURNING id`, [c.code, c.name, JSON.stringify(c.fields.map((l) => ({ key: slug(l), label: l })))]);
    for (const a of c.aliases) await db.query(`INSERT INTO category_aliases(raw,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [a, r!.id]);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
    await db.query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING`, [k, JSON.stringify(v)]);
  const users = await one(db, "SELECT count(*)::int AS n FROM users");
  if (!users!.n) {
    const email = process.env.ADMIN_EMAIL || "admin@paulicomp.local";
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) throw new Error("Defina ADMIN_PASSWORD no .env para criar o primeiro administrador.");
    await db.query(`INSERT INTO users(name,email,password_hash,roles) VALUES($1,$2,$3,$4)`,
      [process.env.ADMIN_NAME || "Administrador", email, hashPassword(pw), ["admin", "pesquisador", "validador"]]);
    console.log(`Administrador criado: ${email}`);
  }
  console.log(`Banco pronto (${driver.kind}).`);
}

export function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function getSetting<T = any>(key: string): Promise<T> {
  return (await one(db, "SELECT value FROM settings WHERE key=$1", [key]))?.value as T;
}

export async function logChange(q: Q, e: { entity: string; entity_id?: number | null; product_id?: number | null; lot_id?: number | null; action: string; field?: string | null; old_value?: unknown; new_value?: unknown; reason?: string | null; user_id?: number | null }) {
  await q.query(`INSERT INTO change_log(entity,entity_id,product_id,lot_id,action,field,old_value,new_value,reason,user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.entity, e.entity_id ?? null, e.product_id ?? null, e.lot_id ?? null, e.action, e.field ?? null,
      e.old_value === undefined ? null : JSON.stringify(e.old_value), e.new_value === undefined ? null : JSON.stringify(e.new_value), e.reason ?? null, e.user_id ?? null]);
}
