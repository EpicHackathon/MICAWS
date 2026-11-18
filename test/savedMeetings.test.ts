import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import pg from "pg";
import {
  newMeeting,
  applyCommand,
  searchTranscript,
} from "../src/shared/savedMeeting.js";
import { MeetingStore } from "../server/store.js";
import { createAuth, authorize } from "../server/auth.js";
import { createHttpHandler } from "../server/http.js";
import { createProvider, validateIntelligence } from "../server/provider.js";
import { createMicawsClient } from "../sdk/client.js";
import { draftVault } from "../src/services/recoveryDraft.js";

const input = () => ({
  id: randomUUID(),
  title: "Launch planning",
  series: "Launch",
});
const segment = (
  id = "s1",
  revision = 1,
  text = "We agreed to launch on Friday.",
  time = 0,
) => ({ id, revision, time, end: time + 5, speaker: "Alex", text });
const citation = (s) => ({
  segmentId: s.id,
  revision: s.revision,
  quote: s.text,
});
const root = {
  id: "launch",
  label: "Launch",
  summary: "Launch Friday.",
  parentId: null,
  importance: 5,
};
const state = { nodes: [root], edges: [], actionItems: [] };
const command = (segments) => ({ type: "segments", segments });
const env = {
  SESSION_SECRET: "x".repeat(48),
  SERVICE_CREDENTIALS: JSON.stringify([
    { org: "a", key: "a".repeat(40) },
    { org: "b", key: "b".repeat(40) },
  ]),
  AI_PROVIDER: "mock",
  APP_ORIGIN: "http://localhost",
  EMBED_ORIGINS: "https://partner.example",
};
async function fixture(t) {
  let pool;
  if (process.env.MICAWS_TEST_DATABASE_URL) {
    const admin = new pg.Pool({
      connectionString: process.env.MICAWS_TEST_DATABASE_URL,
    });
    const schema = `micaws_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: process.env.MICAWS_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
  } else {
    const adapter = newDb().adapters.createPg();
    pool = new adapter.Pool();
    t.after(() => pool.end());
  }
  const store = new MeetingStore(pool);
  await store.migrate();
  return store;
}

test("segment IDs/revisions deduplicate retries, reject conflicting corrections, and sort late arrivals", () => {
  let m = newMeeting(input());
  m = applyCommand(
    m,
    command([segment("later", 1, "Later", 20), segment()]),
  ).meeting;
  assert.deepEqual(
    m.segments.map((s) => s.id),
    ["s1", "later"],
  );
  assert.equal(applyCommand(m, command([segment()])).changed, false);
  assert.throws(
    () => applyCommand(m, command([segment("s1", 1, "Different")])),
    { status: 409 },
  );
  m = applyCommand(
    m,
    command([segment("s1", 2, "We agreed to launch on Monday.")]),
  ).meeting;
  assert.equal(applyCommand(m, command([segment()])).changed, false);
  assert.match(m.segments[0].text, /Monday/);
});

test("corrections invalidate quotes, summaries, suggestions and translations but preserve manual edits", () => {
  let m = applyCommand(newMeeting(input()), command([segment()])).meeting;
  m = applyCommand(m, { type: "edit", state }).meeting;
  m.evidence = { "node:launch": [citation(m.segments[0])] };
  m.summary = [{ text: "Friday", citations: [citation(m.segments[0])] }];
  m.translations = { s1: { revision: 1, text: "Viernes" } };
  m.decisions = [
    { id: "confirmed", confirmed: true, citations: [citation(m.segments[0])] },
    { id: "suggested", confirmed: false },
  ];
  m = applyCommand(m, command([segment("s1", 2, "Monday instead.")])).meeting;
  assert.deepEqual(m.state, state);
  assert.deepEqual(m.lockedIds, ["launch"]);
  assert.deepEqual(m.summary, []);
  assert.deepEqual(m.evidence["node:launch"], []);
  assert.deepEqual(m.translations, {});
  assert.equal(m.decisions.length, 1);
  assert.deepEqual(m.decisions[0].citations, []);
});

test("evidence validation rejects invented quotes and missing generated sources", () => {
  const m = applyCommand(newMeeting(input()), command([segment()])).meeting;
  const raw = {
    state,
    evidence: [{ target: "node:launch", citations: [citation(segment())] }],
    summary: [],
    decisions: [],
  };
  assert.equal(validateIntelligence(raw, m).state.nodes.length, 1);
  assert.throws(() => validateIntelligence({ ...raw, evidence: [] }, m), {
    status: 502,
  });
  assert.throws(
    () =>
      validateIntelligence(
        {
          ...raw,
          evidence: [
            {
              target: "node:launch",
              citations: [{ ...citation(segment()), quote: "Never spoken" }],
            },
          ],
        },
        m,
      ),
    { status: 502 },
  );
  const manual = applyCommand(m, { type: "edit", state }).meeting;
  assert.throws(
    () =>
      validateIntelligence(
        { ...raw, state: { ...state, nodes: [{ ...root, label: "Changed" }] } },
        manual,
      ),
    { status: 502 },
  );
});

test("search is transcript-scoped, handles Unicode and never manufactures an answer", () => {
  const m = applyCommand(
    newMeeting(input()),
    command([segment(), segment("es", 1, "La reunión será mañana.", 10)]),
  ).meeting;
  assert.equal(searchTranscript(m, "mañana")[0].id, "es");
  assert.deepEqual(searchTranscript(m, "notpresent"), []);
});

test("browser sessions expire, reject tampering, and cannot cross meeting/role boundaries", () => {
  const auth = createAuth(env);
  const id = randomUUID();
  const token = auth.issue(
    { org: "a", service: true },
    { meetingId: id, role: "viewer" },
  ).token;
  const claims = auth.read(`Bearer ${token}`);
  assert.throws(() => authorize(claims, randomUUID()), { status: 403 });
  assert.throws(() => authorize(claims, id, true), { status: 403 });
  assert.throws(() => auth.issue(claims), { status: 403 });
  assert.throws(() => auth.read(`Bearer ${token}x`), { status: 401 });
  const now = Date.now;
  Date.now = () => now() + 1000000;
  try {
    assert.throws(() => auth.read(`Bearer ${token}`), { status: 401 });
  } finally {
    Date.now = now;
  }
});

test("encrypted pending changes recover after reload without plaintext or cross-meeting access", async () => {
  const entries = new Map();
  const storage = {
    getItem: (k) => entries.get(k),
    setItem: (k, v) => entries.set(k, v),
    removeItem: (k) => entries.delete(k),
  };
  const auth = createAuth(env);
  const p = { org: "a", role: "editor" };
  const id = randomUUID();
  const key = auth.recoveryKey(p, id);
  const vault = await draftVault(key, storage);
  const pending = { revision: 1, command: command([segment()]) };
  await vault.save(id, pending);
  assert.ok(![...entries.values()][0].includes("Friday"));
  assert.deepEqual(await (await draftVault(key, storage)).read(id), pending);
  await assert.rejects(
    (await draftVault(auth.recoveryKey({ ...p, org: "b" }, id), storage)).read(
      id,
    ),
  );
  vault.clear(id);
  assert.equal(await vault.read(id), null);
});

test("PostgreSQL repository persists revisions, queues work and isolates organizations", async (t) => {
  const store = await fixture(t);
  let m = await store.create("a", input());
  await assert.rejects(store.get("b", m.id), { status: 404 });
  m = await store.command("a", m.id, 0, command([segment()]));
  assert.equal(m.revision, 1);
  const reopened = new MeetingStore(store.pool);
  assert.equal(
    (await reopened.get("a", m.id)).segments[0].text,
    segment().text,
  );
  await assert.rejects(store.command("a", m.id, 0, { type: "finish" }), {
    status: 409,
  });
  assert.equal((await store.events("a", m.id, 0)).length, 1);
  assert.equal((await store.pool.query("SELECT * FROM jobs")).rows.length, 1);
  await store.remove("a", m.id);
  assert.equal((await store.pool.query("SELECT * FROM jobs")).rows.length, 0);
  assert.equal(
    (await store.pool.query("SELECT * FROM meeting_events")).rows.length,
    0,
  );
});

test("worker rejects stale corrections and expired leases, but commits an unchanged prefix during continuous arrivals", async (t) => {
  const store = await fixture(t);
  let m = await store.create("a", input());
  m = await store.command("a", m.id, 0, command([segment()]));
  const job = { org: "a", meeting_id: m.id, lease: "test" };
  await store.pool.query("UPDATE jobs SET lease=$1", ["test"]);
  const snapshot = m;
  m = await store.command(
    "a",
    m.id,
    m.revision,
    command([segment("s2", 1, "Next item", 10)]),
  );
  await store.finish(job, snapshot, {
    state,
    summary: [],
    evidence: {},
    decisions: [],
    translations: {},
  });
  m = await store.get("a", m.id);
  assert.equal(m.state.nodes[0].id, "launch");
  assert.equal(m.processing, "queued");
  const beforeCorrection = m;
  await store.pool.query("UPDATE jobs SET lease=$1", ["test"]);
  m = await store.command(
    "a",
    m.id,
    m.revision,
    command([segment("s1", 2, "Corrected launch date")]),
  );
  await store.finish(job, beforeCorrection, {
    state: { nodes: [], edges: [], actionItems: [] },
  });
  assert.deepEqual((await store.get("a", m.id)).state, state);
  await store.finish({ ...job, lease: "expired" }, m, {
    state: { nodes: [], edges: [], actionItems: [] },
  });
  assert.deepEqual((await store.get("a", m.id)).state, state);
});

test("recording deletion is queued durably and drained by cleanup", async (t) => {
  const store = await fixture(t);
  const m = await store.create("a", input());
  await store.setRecording("a", m.id, 0, {
    key: "private/test.wav",
    size: 44,
    type: "audio/wav",
    offset: 0,
  });
  await store.remove("a", m.id);
  assert.equal(
    (await store.pool.query("SELECT * FROM object_cleanup")).rows.length,
    1,
  );
  const removed = [];
  await store.sweep({ remove: async (key) => removed.push(key) });
  assert.deepEqual(removed, ["private/test.wav"]);
  assert.equal(
    (await store.pool.query("SELECT * FROM object_cleanup")).rows.length,
    0,
  );
});

test("lost command responses can be replayed after restart without duplicate edits", async (t) => {
  const store = await fixture(t);
  const m = await store.create("a", input());
  const key = randomUUID();
  const edit = { type: "edit", state };
  const saved = await store.command("a", m.id, 0, edit, key);
  const restarted = new MeetingStore(store.pool);
  const replay = await restarted.command("a", m.id, 0, edit, key);
  assert.equal(replay.revision, saved.revision);
  await assert.rejects(
    restarted.command("a", m.id, saved.revision, { type: "finish" }, key),
    { status: 409 },
  );
});

test("retries preserve input and stop after a bounded number of provider failures", async (t) => {
  const store = await fixture(t);
  let m = await store.create("a", input());
  m = await store.command("a", m.id, 0, command([segment()]));
  const job = { org: "a", meeting_id: m.id, lease: "retry" };
  for (let i = 0; i < 5; i++) {
    await store.pool.query("UPDATE jobs SET lease=$1", [job.lease]);
    await store.finish(job, m, null, true);
    m = await store.get("a", m.id);
  }
  assert.equal(m.processing, "failed");
  assert.equal(m.segments.length, 1);
  assert.equal((await store.pool.query("SELECT * FROM jobs")).rows.length, 0);
  m = await store.command("a", m.id, m.revision, { type: "retry" });
  assert.equal(m.processing, "queued");
});

test("retention expires access and removes saved data from active storage", async (t) => {
  const store = await fixture(t);
  const m = await store.create("a", input());
  await store.pool.query("UPDATE meetings SET expires_at=$1", [new Date(0)]);
  await assert.rejects(store.get("a", m.id), { status: 404 });
  assert.deepEqual(await store.list("a"), []);
  await store.sweep(null);
  assert.equal(
    (await store.pool.query("SELECT * FROM meetings")).rows.length,
    0,
  );
});

test("authenticated HTTP integration covers create, corrected ingest, readonly access, history, origin denial and deletion", async (t) => {
  const store = await fixture(t);
  const auth = createAuth(env);
  const server = http.createServer(
    createHttpHandler({
      store,
      auth,
      provider: createProvider(env),
      objects: null,
      env,
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const backend = createMicawsClient({ baseUrl, token: "a".repeat(40) });
  let m = await backend.create(input());
  const session = await backend.issueSession(m.id, "editor");
  const client = createMicawsClient({ baseUrl, token: session.token });
  m = await client.command(m.id, 0, command([segment()]));
  m = await client.command(
    m.id,
    m.revision,
    command([segment("s1", 2, "We agreed on Monday.")]),
  );
  assert.equal((await client.search(m.id, "Monday")).length, 1);
  await assert.rejects(client.list(), { status: 403 });
  const viewer = createMicawsClient({
    baseUrl,
    token: (await backend.issueSession(m.id)).token,
  });
  await assert.rejects(viewer.command(m.id, m.revision, { type: "finish" }), {
    status: 403,
  });
  await assert.rejects(
    createMicawsClient({ baseUrl, token: "b".repeat(40) }).get(m.id),
    { status: 404 },
  );
  const response = await fetch(`${baseUrl}/api/v1/meetings`, {
    headers: {
      Origin: "https://attacker.example",
      Authorization: "Bearer " + "a".repeat(40),
    },
  });
  assert.equal(response.status, 403);
  await assert.rejects(client.ask(m.id, "When?"), { status: 503 });
  const second = await backend.create({ ...input(), title: "Follow up" });
  assert.equal((await backend.list()).length, 2);
  assert.equal(second.series, m.series);
  await client.remove(m.id);
  await assert.rejects(client.get(m.id), { status: 404 });
});

test(
  "real PostgreSQL lease claiming is exclusive and expired work is recoverable",
  { skip: !process.env.MICAWS_TEST_DATABASE_URL },
  async (t) => {
    const store = await fixture(t);
    let m = await store.create("a", input());
    await store.command("a", m.id, m.revision, command([segment()]));
    const claims = await Promise.all([store.claim(), store.claim()]);
    assert.equal(claims.filter(Boolean).length, 1);
    await store.pool.query(
      "UPDATE jobs SET lease_until=now()-interval '1 minute'",
    );
    const next = await store.claim();
    assert.notEqual(next.lease, claims.find(Boolean).lease);
  },
);


test("provider answers require current quotes and human evidence overrides generated references", async t => {
  const meeting = applyCommand(newMeeting(input()), command([segment(), segment("s2", 1, "A second source.", 10)])).meeting;
  const manual = [citation(meeting.segments[1])];
  meeting.evidence = { "node:launch": manual };
  meeting.lockedEvidenceTargets = ["node:launch"];
  const validated = validateIntelligence({ state, evidence: [{target:"node:launch", citations:[citation(meeting.segments[0])]}], summary:[], decisions:[] }, meeting);
  assert.deepEqual(validated.evidence["node:launch"], manual);
  let output = { answer:"Friday", citations:[citation(meeting.segments[0])] };
  t.mock.method(globalThis, "fetch", async () => Response.json({message:{content:JSON.stringify(output)}}));
  let calls = 0;
  const provider = createProvider({AI_PROVIDER:"ollama"}, async () => { calls++; });
  assert.equal((await provider.ask("a", meeting, "When?")).answer, "Friday");
  output = {answer:"An unsupported answer",citations:[]};
  assert.match((await provider.ask("a", meeting, "Unknown?")).answer, /not contain enough evidence/);
  output = {answer:"Wrong",citations:[{...citation(meeting.segments[0]),revision:99}]};
  await assert.rejects(provider.ask("a", meeting, "When?"), {status:502});
  assert.equal(calls,3);
});


test("reserved object keys cannot become transcript or task identifiers", () => {
  const m = newMeeting(input());
  assert.throws(() => applyCommand(m, command([segment("__proto__")])));
  assert.throws(() => applyCommand(m, {type:"edit", state:{...state,actionItems:[{id:"constructor",text:"Bad identifier"}]}}));
});

 test("duplicate segments remain idempotent after a database round trip", async (t) => {
  const store = await fixture(t);
  let m = await store.create("a", input());
  m = await store.command("a", m.id, 0, command([segment()]));
  const saved = await store.get("a", m.id);
  const repeated = await store.command("a", m.id, saved.revision, command([segment()]));
  assert.equal(repeated.revision, saved.revision);
  assert.deepEqual(repeated.segments, saved.segments);
});
