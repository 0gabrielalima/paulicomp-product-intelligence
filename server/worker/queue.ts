// Fila persistente no proprio Postgres (jobs). Sobrevive a reinicios; nao depende do navegador aberto.
import os from "node:os";
import { db, one, getSetting } from "../db.ts";
import { executeRun } from "./pipeline.ts";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
let running = 0;
let timer: NodeJS.Timeout | null = null;

export async function enqueue(type: string, payload: unknown, opts: { dedupeKey?: string; priority?: number } = {}) {
  try {
    return await one(db, "INSERT INTO jobs(type,payload,dedupe_key,priority) VALUES($1,$2,$3,$4) RETURNING *",
      [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.priority ?? 0]);
  } catch (e: any) {
    if (String(e?.message).includes("jobs_dedupe_active") || e?.code === "23505") return null; // ja existe tarefa ativa igual
    throw e;
  }
}

async function pick() {
  return one(db, `UPDATE jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1, updated_at=now()
    WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=now() ORDER BY priority DESC, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [WORKER_ID]);
}

async function handle(job: any) {
  try {
    if (job.type === "research_run") {
      const r = await executeRun(job.payload.run_id, job.id, job.payload.only_steps);
      if (r === "paused") return; // status do job ja e 'paused'
      if (r === "cancelled") return;
    } else throw new Error(`Tipo de tarefa desconhecido: ${job.type}`);
    await db.query("UPDATE jobs SET status='done', updated_at=now(), locked_at=NULL WHERE id=$1 AND status='running'", [job.id]);
  } catch (e: any) {
    const msg = e?.message || String(e);
    const retry = job.attempts < job.max_attempts;
    await db.query(`UPDATE jobs SET status=$2, last_error=$3, locked_at=NULL, updated_at=now(), run_after=now() + ($4 || ' seconds')::interval WHERE id=$1`,
      [job.id, retry ? "queued" : "failed", msg, String(30 * 2 ** job.attempts)]);
  }
}

async function tick() {
  try {
    const lim = (await getSetting<any>("limites"))?.concorrencia_worker || 2;
    while (running < lim) {
      const job = await pick();
      if (!job) break;
      running++;
      handle(job).finally(() => { running--; });
    }
  } catch (e) { console.error("[worker]", e); }
}

export async function startWorker() {
  // tarefas presas de um processo que caiu voltam para a fila
  await db.query("UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running' AND (locked_by=$1 OR locked_at < now() - interval '15 minutes')", [WORKER_ID]);
  // banco embutido = processo unico: tudo que estava 'running' pertencia a uma execucao anterior
  if (!process.env.DATABASE_URL) await db.query("UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running'");
  timer = setInterval(tick, 2000);
  console.log(`Worker de pesquisas ativo (${WORKER_ID}).`);
}
export const stopWorker = () => { if (timer) clearInterval(timer); };
