import http from "node:http";
import pg from "pg";
import { MeetingStore } from "./store.js";
import { createAuth } from "./auth.js";
import { createProvider } from "./provider.js";
import { objectStorage } from "./objects.js";
import { createHttpHandler } from "./http.js";

const env = process.env;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!env.APP_ORIGIN || new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN)
  throw new Error("APP_ORIGIN must be the exact frontend origin.");
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });
const store = new MeetingStore(pool, {
  retentionDays: Math.max(1, Math.min(365, Number(env.RETENTION_DAYS) || 30)),
});
await store.migrate();
const objects = objectStorage(env);
const provider = createProvider(env, (org) =>
  store.reserveCall(org, Math.max(1, Number(env.AI_DAILY_CALL_LIMIT) || 2000)),
);
const mode = process.argv[2] || "all";
let stopping = false;
let server;
if (mode !== "worker") {
  server = http.createServer(
    createHttpHandler({ store, auth: createAuth(env), provider, objects, env }),
  );
  server.requestTimeout = 130000;
  server.headersTimeout = 15000;
  server.listen(Number(env.PORT) || 8080, env.HOST || "127.0.0.1");
}
async function worker() {
  while (!stopping) {
    try {
      const job = await store.claim();
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      let meeting;
      try {
        meeting = await store.get(job.org, job.meeting_id);
      } catch (error) {
        if (error.status === 404) continue;
        throw error;
      }
      try {
        await store.finish(
          job,
          meeting,
          await provider.process(job.org, meeting),
        );
      } catch {
        await store.finish(job, meeting, null, true);
      }
    } catch {
      console.error(JSON.stringify({ event: "worker_unavailable" }));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
const workers =
  mode === "api"
    ? []
    : Array.from(
        {
          length: Math.max(
            1,
            Math.min(10, Number(env.WORKER_CONCURRENCY) || 2),
          ),
        },
        worker,
      );
const cleanup = setInterval(
  () =>
    store
      .sweep(objects)
      .catch(() => console.error(JSON.stringify({ event: "cleanup_failed" }))),
  60000,
);
async function stop() {
  stopping = true;
  clearInterval(cleanup);
  if (server) await new Promise((resolve) => server.close(resolve));
  await Promise.all(workers);
  await pool.end();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
