import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { initDb } from "./db.ts";
import { authenticate, requireAuth } from "./auth.ts";
import { publicRoutes, core } from "./routes/core.ts";
import { lots } from "./routes/lots.ts";
import { products } from "./routes/products.ts";
import { exportRoutes } from "./export.ts";
import { startWorker } from "./worker/queue.ts";

await initDb();
const app = express();
// Ponte local da pesquisa assistida: abas de pesquisa (Lenovo/Mercado Livre) enviam dados coletados para cá.
// Requisição "simples" (text/plain, sem cookies) autenticada por token local; grava em data/bridge.
app.options("/api/bridge-in/:name", (req, res) => {
  const o = String(req.headers.origin || "");
  if (!/^https:\/\/(support\.lenovo\.com|(www|lista|produto)\.mercadolivre\.com\.br)$/.test(o)) return res.status(403).end();
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.status(204).end();
});
app.post("/api/bridge-in/:name", express.text({ type: "*/*", limit: "20mb" }), (req, res) => {
  const okOrigin = /^https:\/\/(support\.lenovo\.com|(www|lista|produto)\.mercadolivre\.com\.br)$/.test(String(req.headers.origin || ""));
  if (!okOrigin || !process.env.BRIDGE_TOKEN || req.query.t !== process.env.BRIDGE_TOKEN) return res.status(403).end();
  const name = String(req.params.name);
  if (!/^[a-z0-9_-]{1,60}$/i.test(name)) return res.status(400).end();
  fs.mkdirSync(path.resolve("data", "bridge"), { recursive: true });
  fs.writeFileSync(path.resolve("data", "bridge", name + ".json"), String(req.body));
  res.setHeader("Access-Control-Allow-Origin", String(req.headers.origin));
  res.json({ ok: true, bytes: String(req.body).length });
});
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());
app.use(authenticate);
app.use("/api", publicRoutes);
app.use("/api", core);
app.use("/api", requireAuth, lots);
app.use("/api", requireAuth, products);
app.use("/api", requireAuth, exportRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada." }));

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  // index.html nunca fica em cache (sempre aponta para o build atual); assets com hash podem ficar.
  app.use(express.static(dist, { setHeaders: (res, file) => { if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));
  app.get(/^\/(?!api).*/, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(dist, "index.html")); });
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? `Erro interno: ${err.message}` : err.message });
});

const port = Number(process.env.PORT || 3100);
app.listen(port, () => console.log(`API em http://localhost:${port}`));
if (process.env.WORKER_INLINE !== "false") await startWorker();
