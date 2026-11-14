import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from '../api/process.js';
import { processTranscript } from '../src/services/processTranscript.js';
import { demoBatches, demoStates } from '../src/shared/demo.js';
import { emptyMeetingState, meetingSchema } from '../src/shared/meetingSchema.js';

const mock = createHandler({ env: { MEETING_MOCK: 'true' } });
const send = (handler, newSegments, previousState = emptyMeetingState) => handler(
  new Request('http://localhost/api/process', {
    method: 'POST', body: JSON.stringify({ newSegments, previousState }),
  }),
);

test('three sequential updates add, revise and reuse topics', async () => {
  let state = emptyMeetingState;
  for (const [index, batch] of demoBatches.entries()) {
    const response = await send(mock, batch, state);
    assert.equal(response.status, 200);
    state = await response.json();
    assert.deepEqual(state, demoStates[index]);
  }
  assert.deepEqual(state.nodes.map(node => node.id), ['launch', 'marketing']);
  assert.equal(state.actionItems.length, 2);
});

test('empty or blank batches return previous state without a key', async () => {
  const handler = createHandler({ env: {} });
  for (const batch of [[], [{ time: 0, speaker: null, text: ' ' }]]) {
    const response = await send(handler, batch, demoStates[1]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), demoStates[1]);
  }
});

test('invalid transcript, non-POST and missing API key', async () => {
  assert.equal((await send(mock, [{ time: -1, speaker: null, text: 'test' }])).status, 400);
  assert.equal((await mock(new Request('http://localhost/api/process'))).status, 405);
  assert.equal((await send(createHandler({ env: {} }), demoBatches[0])).status, 503);
});

const invalidEdge = { ...demoStates[1], edges: [{ id: 'bad', source: 'launch', target: 'missing' }] };
const duplicateNode = { ...demoStates[0], nodes: [demoStates[0].nodes[0], demoStates[0].nodes[0]] };
test('strict schema rejects dangling edges, duplicate IDs and extra fields', () => {
  for (const bad of [invalidEdge, duplicateNode, { ...emptyMeetingState, extra: 1 }]) {
    assert.equal(meetingSchema.safeParse(bad).success, false);
  }
});

test('Gemini failure, quota, malformed JSON, invalid graph and lost state', async () => {
  const env = { GEMINI_API_KEY: 'test-only' };
  for (const [status, generateText] of [
    [429, async () => { throw Object.assign(new Error('quota'), { status: 429 }); }],
    [502, async () => { throw new Error('network'); }],
    [502, async () => 'not JSON'],
    [502, async () => JSON.stringify(invalidEdge)],
    [502, async () => JSON.stringify(duplicateNode)],
    [502, async () => JSON.stringify(emptyMeetingState)],
  ]) {
    const response = await send(createHandler({ env, generateText }), demoBatches[1], demoStates[0]);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('caller keeps the last valid state on failure and can retry the same batch', async t => {
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/process');
    if (fail) return Response.json({ error: 'Try again' }, { status: 502 });
    return mock(new Request('http://localhost' + url, options));
  });
  let state = structuredClone(demoStates[0]);
  await assert.rejects(async () => {
    state = await processTranscript(demoBatches[1], state);
  }, /Try again/);
  assert.deepEqual(state, demoStates[0]);
  fail = false;
  state = await processTranscript(demoBatches[1], state);
  assert.deepEqual(state, demoStates[1]);
});
