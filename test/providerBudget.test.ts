import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createProvider, providerSchema } from "../server/provider.js";
import { newMeeting, sameJson } from "../src/shared/savedMeeting.js";

test("JSON equality ignores object key order but preserves array order and values", () => {
  assert.ok(sameJson({a: 1, b: [{x: 2, y: 3}]}, {b: [{y: 3, x: 2}], a: 1}));
  assert.ok(!sameJson([1, 2], [2, 1]));
  assert.ok(!sameJson({a: null}, {}));
  assert.ok(!sameJson([], {}));
});

test("one Gemini reservation permits only one transport attempt on outage", async (t) => {
  let requests = 0, reservations = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({error: {code: 503, message: "Synthetic outage", status: "UNAVAILABLE"}}, {status: 503});
  });
  const provider = createProvider({AI_PROVIDER: "gemini", ALLOW_EXTERNAL_AI: "true",
    GEMINI_API_KEY: "test-only", GEMINI_MODEL: "test-model"}, async () => { reservations++; });
  await assert.rejects(provider.ask("test", newMeeting({id: randomUUID(), title: "Test"}), "What was decided?"), {status: 503});
  assert.equal(reservations, 1);
  assert.equal(requests, 1);
});

test("generation grammar removes expensive bounds without changing validation schemas", () => {
 const schema = {type: "array", maxItems: 1500, items: {type: "string", pattern: "^[a-z]+$", maxLength: 2000}};
 assert.deepEqual(providerSchema(schema), {type: "array", items: {type: "string"}});
 assert.equal(schema.maxItems, 1500);
});
test("real SDK quota errors retain status, fall back once and remember exhausted models", async (t) => {
 let calls = 0, reservations = 0;
 t.mock.method(globalThis, "fetch", async () => {
  calls++;
  const status = calls === 1 ? 429 : 503;
  return Response.json({error: {code: status, message: "Synthetic failure", status: status === 429 ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE"}}, {status});
 });
 const provider = createProvider({AI_PROVIDER: "gemini", ALLOW_EXTERNAL_AI: "true", GEMINI_API_KEY: "test-only", GEMINI_MODEL: "first", GEMINI_MODELS: "second"}, async () => {reservations++;});
 const m = newMeeting({id: randomUUID(), title: "Test"});
 await assert.rejects(provider.ask("test", m, "When?"), {status: 503});
 assert.equal(calls, 2);
 await assert.rejects(provider.ask("test", m, "When?"), {status: 503});
 assert.equal(calls, 3);
 assert.equal(reservations, 3);
});
