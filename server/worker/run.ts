// Worker em processo separado (usar somente com DATABASE_URL / Postgres real).
import "dotenv/config";
import { initDb } from "../db.ts";
import { startWorker } from "./queue.ts";

if (!process.env.DATABASE_URL) {
  console.error("O worker separado exige DATABASE_URL. Com o banco embutido, use WORKER_INLINE=true na API.");
  process.exit(1);
}
await initDb();
await startWorker();
