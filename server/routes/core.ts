import { Router } from "express";
import { db, one, hashPassword, logChange, slug } from "../db.ts";
import { login, logout, setSessionCookie, requireAuth, requireRole } from "../auth.ts";
import { integrations } from "../adapters/integrations.ts";
import { fetchPtax } from "../adapters/fx.ts";
import { lotItems } from "../views.ts";
import { round2 } from "../calc.ts";

export const publicRoutes = Router();
export const core = Router();

publicRoutes.post("/auth/login", async (req, res) => {
  const r = await login(String(req.body.email || ""), String(req.body.password || ""));
  if (!r) return res.status(401).json({ error: "E-mail ou senha inválidos." });
  setSessionCookie(res, r.token);
  res.json(r.user);
});
publicRoutes.post("/auth/logout", async (req, res) => { await logout(req, res); res.json({ ok: true }); });
publicRoutes.get("/me", (req, res) => (req.user ? res.json(req.user) : res.status(401).json({ error: "Não autenticado" })));

core.use(requireAuth);

// ---------- Usuarios ----------
const ROLES = ["admin", "pesquisador", "validador", "consulta"];
core.get("/users", requireRole("admin"), async (_req, res) => res.json(await db.query("SELECT id,name,email,roles,active,created_at FROM users ORDER BY name")));
core.post("/users", requireRole("admin"), async (req, res) => {
  const { name, email, password, roles } = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: "Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios." });
  const r = (roles || []).filter((x: string) => ROLES.includes(x));
  try {
    const u = await one(db, "INSERT INTO users(name,email,password_hash,roles) VALUES($1,$2,$3,$4) RETURNING id", [name, email.trim().toLowerCase(), hashPassword(password), r.length ? r : ["consulta"]]);
    await logChange(db, { entity: "usuario", entity_id: u!.id, action: "usuario_criado", new_value: { name, email, roles: r }, user_id: req.user!.id });
    res.json(u);
  } catch { res.status(400).json({ error: "E-mail já cadastrado." }); }
});
core.patch("/users/:id", requireRole("admin"), async (req, res) => {
  const u = await one(db, "SELECT * FROM users WHERE id=$1", [req.params.id]);
  if (!u) return res.status(404).json({ error: "Usuário não encontrado." });
  const { name, roles, active, password } = req.body;
  if (Number(req.params.id) === req.user!.id && (active === false || (roles && !roles.includes("admin")))) return res.status(400).json({ error: "Você não pode remover seu próprio acesso de administrador." });
  await db.query("UPDATE users SET name=COALESCE($2,name), roles=COALESCE($3,roles), active=COALESCE($4,active) WHERE id=$1",
    [u.id, name ?? null, roles ? roles.filter((x: string) => ROLES.includes(x)) : null, active ?? null]);
  if (password) { if (password.length < 8) return res.status(400).json({ error: "Senha deve ter ao menos 8 caracteres." }); await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [u.id, hashPassword(password)]); await db.query("DELETE FROM sessions WHERE user_id=$1", [u.id]); }
  await logChange(db, { entity: "usuario", entity_id: u.id, action: "usuario_alterado", old_value: { name: u.name, roles: u.roles, active: u.active }, new_value: { name, roles, active, senha_alterada: !!password }, user_id: req.user!.id });
  res.json({ ok: true });
});

// ---------- Configuracoes ----------
core.get("/settings", async (_req, res) => {
  const rows = await db.query("SELECT key, value FROM settings");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});
core.put("/settings/:key", requireRole("admin"), async (req, res) => {
  if (!["validade", "limites", "proprios"].includes(String(req.params.key))) return res.status(400).json({ error: "Configuração desconhecida." });
  const old = await one(db, "SELECT value FROM settings WHERE key=$1", [req.params.key]);
  await db.query("UPDATE settings SET value=$2, updated_at=now(), updated_by=$3 WHERE key=$1", [req.params.key, JSON.stringify(req.body), req.user!.id]);
  await logChange(db, { entity: "configuracao", action: `configuracao_${req.params.key}`, old_value: old?.value, new_value: req.body, user_id: req.user!.id });
  res.json({ ok: true });
});
core.get("/integrations", (_req, res) => res.json(integrations()));

core.get("/categories", async (_req, res) => {
  const cats = await db.query("SELECT * FROM categories ORDER BY name");
  const aliases = await db.query("SELECT * FROM category_aliases ORDER BY raw");
  res.json({ categories: cats, aliases });
});
core.put("/categories/:id", requireRole("admin"), async (req, res) => {
  const labels: string[] = (req.body.fields || []).map((s: any) => String(typeof s === "string" ? s : s.label).trim()).filter(Boolean);
  await db.query("UPDATE categories SET name=COALESCE($2,name), fields=$3 WHERE id=$1", [req.params.id, req.body.name ?? null, JSON.stringify(labels.map((l) => ({ key: slug(l), label: l })))]);
  await logChange(db, { entity: "categoria", entity_id: Number(req.params.id), action: "campos_categoria_alterados", new_value: labels, user_id: req.user!.id });
  res.json({ ok: true });
});
core.post("/categories", requireRole("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Informe o nome." });
  const r = await one(db, "INSERT INTO categories(code,name,fields) VALUES($1,$2,'[]') ON CONFLICT(code) DO NOTHING RETURNING id", [slug(name), name]);
  res.json(r || { error: "Categoria já existe." });
});
core.put("/category-aliases", requireRole("admin"), async (req, res) => {
  const { raw, category_id } = req.body;
  await db.query("INSERT INTO category_aliases(raw,category_id) VALUES(upper(trim($1)),$2) ON CONFLICT(raw) DO UPDATE SET category_id=EXCLUDED.category_id", [raw, category_id]);
  res.json({ ok: true });
});

core.post("/fx/:currency", async (req, res) => {
  try { res.json(await fetchPtax(req.params.currency)); } catch (e: any) { res.status(400).json({ error: e.message }); }
});
core.get("/fx", async (_req, res) => res.json(await db.query("SELECT id,currency,rate,source,quoted_at,fetched_at FROM fx_quotes ORDER BY fetched_at DESC LIMIT 50")));

// ---------- Historico ----------
core.get("/history", async (req, res) => {
  const p: unknown[] = [], w: string[] = [];
  if (req.query.product_id) { p.push(req.query.product_id); w.push(`h.product_id=$${p.length}`); }
  if (req.query.lot_id) { p.push(req.query.lot_id); w.push(`h.lot_id=$${p.length}`); }
  if (req.query.user_id) { p.push(req.query.user_id); w.push(`h.user_id=$${p.length}`); }
  if (req.query.action) { p.push(`%${req.query.action}%`); w.push(`h.action ILIKE $${p.length}`); }
  const rows = await db.query(`SELECT h.*, u.name AS user_name, pr.sku, l.code AS lot_code FROM change_log h LEFT JOIN users u ON u.id=h.user_id
    LEFT JOIN products pr ON pr.id=h.product_id LEFT JOIN lots l ON l.id=h.lot_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY h.created_at DESC LIMIT 1000`, p);
  res.json(rows);
});

// ---------- Central de validacoes ----------
core.get("/validation-queue", async (_req, res) => {
  const items = await lotItems(null);
  res.json(items.filter((i) => i.full_status !== "aprovado"));
});

// ---------- Dashboard ----------
core.get("/dashboard", async (req, res) => {
  const lotId = req.query.lot_id ? Number(req.query.lot_id) : null;
  const from = req.query.from ? String(req.query.from) : null, to = req.query.to ? String(req.query.to) : null;
  const cat = req.query.category ? String(req.query.category) : null;
  const userId = req.query.user_id ? Number(req.query.user_id) : null;
  let items = await lotItems(lotId);
  if (cat) items = items.filter((i) => i.category === cat);
  if (from || to) {
    const lots = await db.query("SELECT id, created_at, received_at FROM lots");
    const ok = new Set(lots.filter((l) => { const d = String(l.received_at || l.created_at).slice(0, 10); return (!from || d >= from) && (!to || d <= to); }).map((l) => l.id));
    items = items.filter((i) => ok.has(i.lot_id));
  }
  if (userId) {
    const u = await one(db, "SELECT name FROM users WHERE id=$1", [userId]);
    items = items.filter((i) => i.validator === u?.name);
  }
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const runs = productIds.length ? await db.query(`SELECT status, kind, created_at, started_at, finished_at, cost_usd FROM research_runs WHERE product_id = ANY($1) ${lotId ? "AND (lot_id=$2 OR lot_id IS NULL)" : ""}`, lotId ? [productIds, lotId] : [productIds]) : [];
  const cost = await one(db, `SELECT COALESCE(sum(cost_usd),0) AS total, COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS month FROM api_usage`);
  const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce((a: Record<string, number>, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  const latestPerProduct = new Map<number, string>();
  for (const i of items) latestPerProduct.set(i.product_id, i.research_status);
  const rs = [...latestPerProduct.values()];
  const lotsCount = lotId ? 1 : (await one(db, "SELECT count(*)::int AS n FROM lots"))!.n;
  const byDay: Record<string, { criadas: number; concluidas: number; dur: number[] }> = {};
  for (const r of runs) {
    const d = String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at).slice(0, 10);
    byDay[d] ||= { criadas: 0, concluidas: 0, dur: [] };
    byDay[d].criadas++;
    if (["concluida", "parcial"].includes(r.status)) byDay[d].concluidas++;
    if (r.started_at && r.finished_at) byDay[d].dur.push((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000);
  }
  const allDur = runs.filter((r) => r.started_at && r.finished_at).map((r) => (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000);
  res.json({
    kpis: {
      lotes: lotsCount,
      skus_recebidos: items.length,
      skus_unicos: productIds.length,
      unidades: items.reduce((a, i) => a + i.quantity, 0),
      ja_na_base: items.filter((i) => i.existed_before).length,
      aguardando_pesquisa: rs.filter((s) => s === "nao_pesquisado").length,
      em_andamento: rs.filter((s) => ["na_fila", "em_andamento", "pausada"].includes(s)).length,
      concluidas: rs.filter((s) => s === "concluida").length,
      parciais: rs.filter((s) => s === "parcial").length,
      falhas: rs.filter((s) => s === "falha").length,
      aguardando_validacao: items.filter((i) => i.full_status !== "aprovado" && i.research_status !== "nao_pesquisado").length,
      aprovados: items.filter((i) => i.full_status === "aprovado").length,
      nao_identificados: items.filter((i) => i.tech_status === "nao_identificado").length,
      sem_concorrencia_nacional: items.filter((i) => i.research_status !== "nao_pesquisado" && i.nat_count === 0).length,
      pct_conclusao: items.length ? round2((items.filter((i) => i.full_status === "aprovado").length / items.length) * 100) : 0,
      potencial_validado: round2(items.reduce((a, i) => a + (i.total_validated || 0), 0)),
      custo_acumulado_usd: Number(cost?.total || 0), custo_mes_usd: Number(cost?.month || 0),
      tempo_medio_pesquisa_s: allDur.length ? round2(allDur.reduce((a, b) => a + b, 0) / allDur.length) : null,
    },
    charts: {
      evolucao: Object.entries(byDay).sort().map(([d, v]) => ({ dia: d, criadas: v.criadas, concluidas: v.concluidas, tempo_medio_s: v.dur.length ? round2(v.dur.reduce((a, b) => a + b, 0) / v.dur.length) : null })),
      por_categoria: count(items, (i) => i.category || "Sem categoria"),
      status_pesquisa: count(rs, (s) => s),
      status_validacao_tecnica: count(items, (i) => i.tech_status),
      status_validacao_comercial: count(items, (i) => i.approved_price != null ? "aprovada" : i.com_status),
      confianca_tecnica: count(items, (i) => i.conf_tech),
      confianca_comercial: count(items, (i) => i.conf_com),
      aproveitamento_base: { ja_existentes: items.filter((i) => i.existed_before).length, novos: items.filter((i) => !i.existed_before).length },
    },
  });
});
