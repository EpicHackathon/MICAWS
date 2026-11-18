import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createHandler } from '../api/process.js';
import { processTranscript } from '../src/services/processTranscript.js';
import { demoBatches, demoStates } from '../src/shared/demo.js';
import { emptyMeetingState, meetingSchema } from '../src/shared/meetingSchema.js';
import { selectHistoricalContext, useMeetingProcessor, processorTiming } from '../src/hooks/useMeetingProcessor.js';

const mock = createHandler({ env: { MEETING_MOCK: 'true' } });
const send = (handler, newSegments, previousState = emptyMeetingState) => handler(
  new Request('http://localhost/api/process', {
    method: 'POST', body: JSON.stringify({ newSegments, previousState }),
  }),
);

async function setupHook(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const originals = [];
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    originals.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  const originalActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT',
  );
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const seen = {};
  function Probe(props) {
    Object.assign(
      seen,
      useMeetingProcessor(props.segments, props.isRecording, 1_000_000),
    );
    return null;
  }
  const render = props => act(async () => root.render(React.createElement(Probe, props)));
  const sleep = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
    if (originalActEnvironment) {
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalActEnvironment);
    } else {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  });
  return { render, seen, sleep };
}

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

test('Gemini quota falls back in order, remembers exhausted models, and preserves request input', async () => {
  const env = { GEMINI_API_KEY: 'test-only', GEMINI_MODEL: 'first', GEMINI_MODELS: 'second,third', GEMINI_QUOTA_COOLDOWN_MS: '60000' };
  const calls = [];
  const generateText = async (input, _env, model) => {
    calls.push({ model, input });
    if (model !== 'third') throw Object.assign(new Error('quota'), { status: 429 });
    return JSON.stringify(demoStates[0]);
  };
  const handler = createHandler({ env, generateText });
  const original = { newSegments: demoBatches[0], previousState: emptyMeetingState };
  assert.equal((await send(handler, original.newSegments, original.previousState)).status, 200);
  assert.deepEqual(calls.map(call => call.model), ['first', 'second', 'third']);
  // every fallback model gets the same meeting input (plus lockedIds/mapCheck hints for the AI)
  assert.ok(calls.every(call => JSON.stringify(call.input.newSegments) === JSON.stringify(original.newSegments)
    && JSON.stringify(call.input.previousState) === JSON.stringify(original.previousState)));
  calls.length = 0;
  assert.equal((await send(handler, original.newSegments, original.previousState)).status, 200);
  assert.deepEqual(calls.map(call => call.model), ['third']);
});

test('all Gemini models quota limited returns actionable retry without losing input', async () => {
  const handler = createHandler({
    env: { GEMINI_API_KEY: 'test-only', GEMINI_MODEL: 'first', GEMINI_MODELS: 'second' },
    generateText: async () => { throw Object.assign(new Error('quota'), { status: 429 }); },
  });
  const response = await send(handler, demoBatches[0]);
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /Pending meeting input is preserved/);
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

test('long meeting history stays bounded, spans the meeting, and drops exact repetition', () => {
  const transcript = Array.from({ length: 120 }, (_, index) => ({
    time: index * 10,
    speaker: null,
    text: index % 2 === 0 ? 'Repeated status update.' : `Decision ${index} was recorded.`,
  }));
  const context = selectHistoricalContext(transcript, transcript.length);
  const repeated = context.filter(segment => segment.text === 'Repeated status update.');

  assert.equal(context.length, 16);
  assert.equal(repeated.length, 1);
  assert.equal(context[0].time, 0);
  assert.equal(context.at(-1).time, 1190);
  assert.ok(context.reduce((total, segment) => total + segment.text.length, 0) <= 8000);
});

test('scheduled review sends bounded history even when no new transcript is pending', async t => {
  const { render, seen, sleep } = await setupHook(t);
  Object.assign(processorTiming, { reassessmentIntervalMs: 100 });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const state = {
    nodes: [{ id: 'meeting', label: 'Meeting', summary: 'Meeting discussion.', importance: 5, parentId: null }],
    edges: [],
    actionItems: [],
  };
  const transcript = Array.from({ length: 24 }, (_, index) => ({
    time: index * 10,
    speaker: null,
    text: `Evidence statement ${index}.`,
  }));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(state);
  });

  await render({ segments: transcript, isRecording: false });
  await sleep(20);
  assert.equal(seen.pendingCount, 0);
  assert.equal(calls.length, 1);

  now += processorTiming.reassessmentIntervalMs + 1;
  await act(async () => seen.processPending());

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].newSegments, []);
  assert.equal(calls[1].reassessment, true);
  assert.ok(calls[1].historicalContext.length <= 16);
  assert.equal(calls[1].historicalContext[0].time, 0);
  assert.equal(calls[1].historicalContext.at(-1).time, 230);
  assert.equal(seen.pendingCount, 0);
});

test('accepts evidence-backed child and grandchild expansion without changing existing IDs', async () => {
  const previousState = {
    nodes: [
      { id: 'meeting', label: 'Product Planning', summary: 'Plan the pilot.', importance: 5, parentId: null },
      { id: 'pilot', label: 'Pilot', summary: 'Discuss the pilot.', importance: 4, parentId: 'meeting' },
    ],
    edges: [{ id: 'meeting-pilot', source: 'meeting', target: 'pilot' }],
    actionItems: [],
  };
  const expandedState = {
    nodes: [
      previousState.nodes[0],
      previousState.nodes[1],
      { id: 'pilot-scope', label: 'Pilot Scope', summary: 'The pilot includes five customers.', importance: 3, parentId: 'pilot' },
      { id: 'pilot-period', label: 'Trial Period', summary: 'The pilot lasts four weeks.', importance: 2, parentId: 'pilot-scope' },
      { id: 'pilot-measure', label: 'Success Measure', summary: 'Sam will measure conversion.', importance: 3, parentId: 'pilot' },
    ],
    edges: [
      { id: 'meeting-pilot', source: 'meeting', target: 'pilot' },
      { id: 'pilot-pilot-scope', source: 'pilot', target: 'pilot-scope' },
      { id: 'pilot-scope-pilot-period', source: 'pilot-scope', target: 'pilot-period' },
      { id: 'pilot-pilot-measure', source: 'pilot', target: 'pilot-measure' },
    ],
    actionItems: [],
  };
  let receivedInput;
  const handler = createHandler({
    env: { GEMINI_API_KEY: 'test-only' },
    generateText: async input => {
      receivedInput = input;
      return JSON.stringify(expandedState);
    },
  });
  const response = await handler(new Request('http://localhost/api/process', {
    method: 'POST',
    body: JSON.stringify({
      newSegments: [{ time: 250, speaker: 'Speaker 1', text: 'Sam will measure conversion after four weeks.' }],
      historicalContext: [{ time: 50, speaker: 'Speaker 2', text: 'The pilot includes five customers.' }],
      previousState,
    }),
  }));

  assert.equal(response.status, 200);
  assert.equal(meetingSchema.safeParse(await response.json()).success, true);
  assert.deepEqual(receivedInput.historicalContext, [
    { time: 50, speaker: 'Speaker 2', text: 'The pilot includes five customers.' },
  ]);
  assert.equal(receivedInput.mapCheck.mainPointsWithFewDetails[0].id, 'pilot');
  assert.equal(receivedInput.mapCheck.mainPointsWithFewDetails[0].detailCount, 0);
});

test('repetitive content can reassess to the unchanged map without forcing a target', async () => {
  const previousState = structuredClone(demoStates[0]);
  let receivedInput;
  const handler = createHandler({
    env: { GEMINI_API_KEY: 'test-only' },
    generateText: async input => {
      receivedInput = input;
      return JSON.stringify(previousState);
    },
  });
  const repeated = { time: 20, speaker: null, text: 'The launch remains on schedule.' };
  const response = await handler(new Request('http://localhost/api/process', {
    method: 'POST',
    body: JSON.stringify({
      newSegments: [repeated],
      historicalContext: [{ ...repeated, time: 10 }],
      reassessment: true,
      previousState,
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), previousState);
  assert.equal(receivedInput.reassessment, true);
  assert.equal(receivedInput.newSegments[0].text, receivedInput.historicalContext[0].text);
});

test('rejects historical context beyond its count and size bounds', async () => {
  let calls = 0;
  const handler = createHandler({
    env: { GEMINI_API_KEY: 'test-only' },
    generateText: async () => {
      calls += 1;
      return JSON.stringify(demoStates[0]);
    },
  });

  const segment = { time: 0, speaker: null, text: 'Earlier statement.' };
  for (const historicalContext of [
    Array.from({ length: 17 }, (_, index) => ({ ...segment, time: index })),
    [{ ...segment, text: 'x'.repeat(8001) }],
  ]) {
    const response = await handler(new Request('http://localhost/api/process', {
      method: 'POST',
      body: JSON.stringify({
        newSegments: [{ time: 100, speaker: null, text: 'New statement.' }],
        historicalContext,
        previousState: emptyMeetingState,
      }),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});
