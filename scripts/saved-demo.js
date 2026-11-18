// Development-only synthetic demo. Never bind this unauthenticated demo launcher publicly.
import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { newDb } from "pg-mem";
import { MeetingStore } from "../server/store.js";
import { createAuth } from "../server/auth.js";
import { createProvider } from "../server/provider.js";
import { createHttpHandler } from "../server/http.js";

const port = Number(process.env.DEMO_PORT) || 8081;
const env = {
  AI_PROVIDER: "mock",
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  BRAND_NAME: "MICAWS · Demo",
  SAVED_DEMO: "true",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  SERVICE_CREDENTIALS: JSON.stringify([
    { org: "demo", key: randomBytes(32).toString("hex") },
  ]),
};
const adapter = newDb().adapters.createPg();
const store = new MeetingStore(new adapter.Pool());
await store.migrate();
const auth = createAuth(env);
const provider = createProvider(env);
let m = await store.create("demo", {
  id: randomUUID(),
  title: "Launch planning",
  series: "Product launch",
});
const segments = [
  {
    id: "opening",
    revision: 1,
    time: 0,
    end: 9,
    speaker: "Alex",
    text: "We agreed to launch the public beta on Friday. Morgan will publish the announcement.",
  },
  {
    id: "proposal",
    revision: 1,
    time: 10,
    end: 19,
    speaker: "Morgan",
    text: "I suggest inviting twenty customers first. We still need to decide which languages to support.",
  },
];
m = await store.command("demo", m.id, m.revision, {
  type: "segments",
  segments,
});
const state = {
  nodes: [
    {
      id: "launch",
      label: "Public beta launch",
      summary: "The team agreed to launch on Friday.",
      importance: 5,
      parentId: null,
    },
  ],
  edges: [],
  actionItems: [{ id: "announce", text: "Morgan: publish the announcement." }],
};
m = await store.command("demo", m.id, m.revision, { type: "edit", state });
const source = { segmentId: "opening", revision: 1, quote: segments[0].text };
for (const target of ["node:launch", "task:announce"])
  m = await store.command("demo", m.id, m.revision, {
    type: "evidence",
    target,
    citations: [source],
  });
for (const decision of [
  {
    id: "launch-date",
    text: "Launch the public beta on Friday.",
    kind: "decision",
    confirmed: true,
    supersedes: null,
    citations: [source],
  },
  {
    id: "languages",
    text: "Which languages should the beta support?",
    kind: "question",
    confirmed: true,
    supersedes: null,
    citations: [
      { segmentId: "proposal", revision: 1, quote: segments[1].text },
    ],
  },
])
  m = await store.command("demo", m.id, m.revision, {
    type: "decision",
    decision,
  });
const previous = await store.create("demo", {
  id: randomUUID(),
  title: "Earlier discovery",
  series: "Product launch",
});
await store.command("demo", previous.id, 0, {
  type: "decision",
  decision: {
    id: "discovery",
    text: "Start with a private prototype before opening the beta.",
    kind: "decision",
    confirmed: true,
    supersedes: null,
    citations: [],
  },
});
const handler = createHttpHandler({
  store,
  auth,
  provider,
  objects: null,
  env,
});
const server = http.createServer((req, res) => {
  if (req.url === "/api/v1/demo-session" && req.method === "GET") {
    if (req.headers.origin && req.headers.origin !== env.APP_ORIGIN) {
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    return res.end(
      JSON.stringify(
        auth.issue({ org: "demo", service: true }, { role: "editor" }),
      ),
    );
  }
  return handler(req, res);
});
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    // pg-mem is single-process only. Production uses PostgreSQL SKIP LOCKED leases.
    const { rows } = await store.pool.query("SELECT * FROM jobs");
    for (const row of rows) {
      const job = { ...row, lease: randomUUID() };
      await store.pool.query(
        "UPDATE jobs SET lease=$3 WHERE org=$1 AND meeting_id=$2",
        [job.org, job.meeting_id, job.lease],
      );
      const snapshot = await store.get(job.org, job.meeting_id);
      await store.finish(
        job,
        snapshot,
        await provider.process(job.org, snapshot),
      );
    }
  } finally {
    running = false;
  }
}, 1000);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Synthetic demo: http://127.0.0.1:${port}/workspace (data disappears when stopped)`,
  ),
);
function stop() {
  clearInterval(timer);
  server.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
