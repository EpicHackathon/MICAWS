import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createHandler } from '../api/process.js';
import { useMeetingProcessor, processorTiming } from '../src/hooks/useMeetingProcessor.js';

// Gemini has a usage limit. These check the map waits it out instead of hammering it,
// spaces calls while recording, and never loses what was said.
const sleep = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const line = (time, text) => ({ time, speaker: null, text });

async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const originals = [];
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    originals.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const saved = structuredClone(processorTiming);
  t.after(() => Object.assign(processorTiming, saved));
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const seen = {};
  function Probe(props) {
    Object.assign(seen, useMeetingProcessor(props.segments, props.isRecording, 1_000_000, props.options));
    return null;
  }
  const render = props => act(async () => root.render(React.createElement(Probe, props)));
  // cleanup order matters: close the page first (stops its timers), THEN put the globals back
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, old] of originals) old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key];
  });
  return { render, seen };
}

test('Gemini limit (429): waits longer, says so, then catches up with nothing lost', async t => {
  const { render, seen } = await setup(t);
  Object.assign(processorTiming, { retryDelays: [5], limitDelays: [500] });
  const mock = createHandler({ env: { MEETING_MOCK: 'true' } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(Date.now());
    if (calls.length === 1) return Response.json({ error: 'Gemini rate limit or quota reached.' }, { status: 429 });
    return mock(new Request('http://localhost' + url, options));
  });
  await render({ segments: [line(0, 'We decided to launch next week')], isRecording: false });
  await sleep(20);
  assert.equal(calls.length, 1);
  assert.match(seen.error, /usage limit/);
  assert.equal(seen.state.nodes.length, 0);
  await sleep(30);
  assert.equal(calls.length, 1, 'does not retry early (a normal retry would have run after 5ms)');
  // a new line arriving doesn't jump the queue either
  await render({ segments: [line(0, 'We decided to launch next week'), line(3, 'Budget is fine')], isRecording: false });
  await sleep(10);
  assert.equal(calls.length, 1);
  await sleep(500);
  assert.equal(calls.length, 2);
  assert.equal(seen.error, null);
  assert.ok(seen.state.nodes.length > 0);
  assert.equal(seen.pendingCount, 0, 'both lines made it onto the map');
});

test('while recording, AI calls are spaced out; lines wait and go together', async t => {
  const { render, seen } = await setup(t);
  Object.assign(processorTiming, { minGapWhileRecording: 120 });
  const mock = createHandler({ env: { MEETING_MOCK: 'true' } });
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return mock(new Request('http://localhost' + url, options));
  });
  const lines = [line(0, 'First point'), line(10, 'Second point'), line(20, 'Third point')];
  await render({ segments: lines.slice(0, 1), isRecording: true });
  await sleep(20);
  assert.equal(bodies.length, 1);                 // first call right away
  await render({ segments: lines.slice(0, 2), isRecording: true });
  await sleep(10);
  await render({ segments: lines, isRecording: true });
  await sleep(10);
  assert.equal(bodies.length, 1, 'too soon: waits for the gap');
  await sleep(150);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].newSegments.length, 2, 'the two waiting lines went in ONE call');
  assert.equal(seen.pendingCount, 0);
});

test('document removal and edits invalidate in-flight answers and reassess without new speech', async t => {
  const { render, seen } = await setup(t);
  const bodies = [];
  let finishOld;
  const state = { nodes: [{ id: 'user-root', parentId: null, importance: 5, label: 'Manual topic', summary: 'Keep this edit.' }], edges: [], actionItems: [] };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const input = JSON.parse(options.body); bodies.push(input);
    if (bodies.length === 1) return new Promise(resolve => { finishOld = resolve; });
    return Response.json(input.previousState);
  });
  const segments = [line(0, 'Original speech')];
  await render({ segments, isRecording: false });
  await act(async () => seen.applyEdit(() => state));
  await sleep(10);
  assert.equal(bodies[1].reassessment, true);
  assert.deepEqual(bodies[1].lockedIds, ['user-root']);
  await act(async () => finishOld(Response.json({nodes:[], edges:[], actionItems:[]})));
  assert.equal(seen.state.nodes[0].label, 'Manual topic');
  const materials = [{id:'doc',name:'reference.txt',pages:[{page:1,text:'Background'}]}];
  await render({segments,isRecording:false,options:{materials}});
  await sleep(10);
  assert.equal(bodies.at(-1).materials.length,1);
  await render({segments,isRecording:false,options:{materials:[]}});
  await sleep(10);
  assert.equal(bodies.at(-1).materials.length,0);
  assert.equal(bodies.at(-1).newSegments.length,0);
  assert.equal(bodies.at(-1).reassessment,true);
});
