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

test('mock replay preserves the latest summary and unrelated meeting content', async () => {
  const previous = structuredClone(demoStates[2]);
  previous.nodes.push({ id: 'budget', label: 'Budget', summary: 'Budget agreed.', importance: 4, parentId: 'launch' });
  previous.edges.push({ id: 'launch-budget', source: 'launch', target: 'budget' });
  previous.actionItems.push({ id: 'budget-task', text: 'Alex will check the budget.' });
  const response = await send(mock, demoBatches[0], previous);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), previous);
});

test('service validates input and skips empty batches before contacting server', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request');
  });
  assert.deepEqual(await processTranscript([], demoStates[0]), demoStates[0]);
  await assert.rejects(processTranscript([{ time: -1, speaker: null, text: 'bad' }]), /Invalid transcript/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('service exposes connection failures and rejects invalid successful responses', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(processTranscript(demoBatches[0]), /Could not reach/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json(invalidEdge));
  await assert.rejects(processTranscript(demoBatches[0]), /invalid meeting state/);
});

test('invalid JSON request returns 400 and self-loops are rejected', async () => {
  const response = await mock(new Request('http://localhost/api/process', {
    method: 'POST', body: '{',
  }));
  assert.equal(response.status, 400);
  const state = { ...demoStates[0], edges: [{ id: 'loop', source: 'launch', target: 'launch' }] };
  assert.equal(meetingSchema.safeParse(state).success, false);
});

const detailState = () => {
  const state = structuredClone(demoStates[1]);
  state.nodes.push({ id: 'campaign-detail', label: 'Campaign Owner', summary: 'Sam will draft the campaign.', importance: 3, parentId: 'marketing' });
  state.edges.push({ id: 'marketing-campaign-detail', source: 'marketing', target: 'campaign-detail' });
  return state;
};

// Adds a chain of `count` nodes below campaign-detail (level 3), e.g. count 2 -> levels 4 and 5.
const addChain = (state, count) => {
  let parent = 'campaign-detail';
  for (let i = 1; i <= count; i += 1) {
    const id = 'deep-' + i;
    state.nodes.push({ id, label: 'Deeper ' + i, summary: 'A deeper sub-detail.', importance: 2, parentId: parent });
    state.edges.push({ id: parent + '-' + id, source: parent, target: id });
    parent = id;
  }
  return state;
};

test('hierarchy accepts empty, root-only, three-, four- and five-level states', () => {
  for (const state of [emptyMeetingState, ...demoStates, detailState(), addChain(detailState(), 1), addChain(detailState(), 2)]) {
    assert.equal(meetingSchema.safeParse(state).success, true);
  }
});

test('hierarchy rejects a sixth level with a clear message', () => {
  const result = meetingSchema.safeParse(addChain(detailState(), 3));
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.message === 'Tree exceeds five levels'));
});

test('hierarchy rejects roots, orphans, cycles, deep nesting and incorrect importance', () => {
  const changes = [
    state => { state.nodes[1].parentId = null; },
    state => { state.nodes[1].parentId = 'missing'; },
    state => { state.nodes[1].parentId = 'campaign-detail'; },
    state => { state.nodes[1].parentId = 'marketing'; },
    state => { state.nodes[0].importance = 4; },
    state => { state.nodes[1].importance = 5; },
    state => { delete state.nodes[1].parentId; },
    state => { addChain(state, 3); },   // six levels: too deep
  ];
  for (const change of changes) {
    const state = detailState();
    change(state);
    assert.equal(meetingSchema.safeParse(state).success, false);
  }
});

test('edges must exactly represent the tree with canonical IDs', () => {
  const changes = [
    state => { state.edges.pop(); },
    state => { state.edges[0].id = 'wrong'; },
    state => { state.edges[0].source = 'marketing'; state.edges[0].target = 'launch'; },
    state => { state.edges.push({ id: 'extra', source: 'launch', target: 'marketing' }); },
    state => { state.edges.push({ id: 'launch-launch', source: 'launch', target: 'launch' }); },
  ];
  for (const change of changes) {
    const state = detailState();
    change(state);
    assert.equal(meetingSchema.safeParse(state).success, false);
  }
});

test('mock preserves every parent between updates', async () => {
  const previous = demoStates[1];
  const response = await send(mock, demoBatches[2], previous);
  assert.equal(response.status, 200);
  const next = await response.json();
  for (const node of previous.nodes) {
    assert.equal(next.nodes.find(updated => updated.id === node.id).parentId, node.parentId);
  }
});

// The AI may now move/merge topics it made itself (see test/merging.test.js),
// but never a topic a person edited (lockedIds).
test('server rejects a valid tree that moves a hand-edited (locked) topic', async () => {
  const previous = detailState();
  const next = structuredClone(previous);
  next.nodes[2].parentId = 'launch';
  next.edges[1] = { id: 'launch-campaign-detail', source: 'launch', target: 'campaign-detail' };
  assert.equal(meetingSchema.safeParse(next).success, true);
  const handler = createHandler({
    env: { GEMINI_API_KEY: 'test-only' }, generateText: async () => JSON.stringify(next),
  });
  const response = await handler(new Request('http://localhost/api/process', {
    method: 'POST',
    body: JSON.stringify({ newSegments: demoBatches[2], previousState: previous, lockedIds: ['campaign-detail'] }),
  }));
  assert.equal(response.status, 502);
});

test('manual text in mock mode produces a valid quoted topic without invented tasks', async () => {
  const segments = [{ time: 0, speaker: null, text: 'We decided to launch next week' }];
  const response = await send(mock, segments);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(meetingSchema.safeParse(state).success, true);
  assert.ok(state.nodes.some(node => node.summary === segments[0].text));
  assert.deepEqual(state.actionItems, []);
  const retry = await send(mock, segments, state);
  assert.deepEqual(await retry.json(), state);
});

test('manual text and sample batches can be mixed in either order', async () => {
  const manual = [{ time: 0, speaker: null, text: 'Review our budget tomorrow.' }];
  for (const batches of [[manual, demoBatches[0]], [demoBatches[0], manual]]) {
    let state = emptyMeetingState;
    for (const batch of batches) {
      const response = await send(mock, batch, state);
      assert.equal(response.status, 200);
      const next = await response.json();
      for (const node of state.nodes) assert.ok(next.nodes.some(item => item.id === node.id && item.parentId === node.parentId));
      state = next;
    }
    assert.ok(state.nodes.some(node => node.summary === manual[0].text));
  }
});

test('a combined mock request keeps both sample and arbitrary text', async () => {
  const text = 'The budget needs review.';
  const response = await send(mock, [...demoBatches[0], { time: 0, speaker: null, text }]);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.ok(state.nodes.some(node => node.id === 'launch'));
  assert.ok(state.nodes.some(node => node.summary === text));
});
