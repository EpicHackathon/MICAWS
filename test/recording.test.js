import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createServer } from 'vite';
import { createHandler } from '../api/process.js';
import { installAudioMocks } from './helpers/audio.js';

test('recording hook and App handle permissions, transcription retries, processing retries and reset', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const originals = new Map();
  function expose(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'SVGElement', 'Node', 'MutationObserver']) {
    expose(key, dom.window[key]);
  }
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  expose('requestAnimationFrame', callback => setTimeout(callback, 0));
  expose('cancelAnimationFrame', clearTimeout);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.confirm = () => true;
  const audio = installAudioMocks(t);
  const handler = createHandler({ env: { MEETING_MOCK: 'true' } });
  const transcriptions = [], requests = [];
  let failTranscription = true, failProcessor = true, holdTranscription = false, finishTranscription;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/transcribe') {
      transcriptions.push(options);
      if (holdTranscription) return new Promise(resolve => { finishTranscription = resolve; });
      if (failTranscription) {
        failTranscription = false;
        return Response.json({ detail: 'Transcription temporarily unavailable' }, { status: 503 });
      }
      const start = Number(options.body.get('start_seconds'));
      return Response.json([{ start, end: start + 1, speaker: null, text: 'We agreed to launch next week.' }]);
    }
    assert.equal(url, '/api/process');
    requests.push(JSON.parse(options.body));
    if (failProcessor) {
      failProcessor = false;
      return Response.json({ error: 'AI temporarily unavailable' }, { status: 502 });
    }
    return handler(new Request('http://localhost' + url, options));
  });
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await server.ssrLoadModule('/src/App.jsx');
  const root = createRoot(document.getElementById('root'));
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const click = async text => {
    const target = button(text);
    assert.ok(target, 'Button exists: ' + text);
    await act(async () => target.click());
  };
  async function until(predicate) {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.ok(predicate(), document.body.textContent);
  }
  const startLabel = '🎤 Start Recording';
  const stopLabel = '🛑 Stop & Process Stream';
  const emit = async (node, data) => act(async () => node.emit(data));
  const chunk = { type: 'chunk', startSample: 0, samples: new Float32Array(16000), sampleRate: 16000 };
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.equal(button(startLabel).disabled, false);
    assert.equal(button(stopLabel).disabled, true);

    const getMicrophone = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Permission denied'); };
    await click(startLabel);
    await until(() => document.body.textContent.includes('Permission denied'));
    assert.equal(button(startLabel).disabled, false);
    assert.equal(audio.contexts[0].state, 'closed');
    navigator.mediaDevices.getUserMedia = getMicrophone;

    await click(startLabel);
    await until(() => !button(stopLabel).disabled);
    assert.equal(button(startLabel).disabled, true);
    assert.ok(document.body.textContent.includes('Live recording in progress'));
    await click(stopLabel);
    assert.equal(button(stopLabel).disabled, true);
    assert.ok(audio.tracks[0].stops > 0);
    assert.deepEqual(audio.nodes[0].commands, ['stop']);
    await emit(audio.nodes[0], chunk);
    await emit(audio.nodes[0], { type: 'stopped' });
    await until(() => document.body.textContent.includes('Transcription temporarily unavailable'));
    assert.equal(requests.length, 0);
    await click('Process pending / retry');
    await until(() => document.body.textContent.includes('AI temporarily unavailable'));
    assert.equal(transcriptions[0].body.get('chunk_id'), transcriptions[1].body.get('chunk_id'));
    assert.deepEqual(requests[0].newSegments, [{ time: 0, speaker: null, text: 'We agreed to launch next week.' }]);
    assert.ok(document.querySelector('[aria-label="Transcript"]').textContent.includes('0.0s'));
    await click('Process pending / retry');
    await until(() => document.body.textContent.includes('Topics (2)'));
    assert.deepEqual(requests[1], requests[0]);

    await click(startLabel);
    await until(() => !button(stopLabel).disabled);
    await click(stopLabel);
    await emit(audio.nodes[1], chunk);
    await emit(audio.nodes[1], { type: 'stopped' });
    await until(() => requests.length === 3);
    assert.equal(transcriptions[2].body.get('start_seconds'), '1');
    assert.deepEqual(requests[2].newSegments, [{ time: 1, speaker: null, text: 'We agreed to launch next week.' }]);
    assert.equal(document.querySelectorAll('[aria-label="Transcript"] p').length, 2);

    holdTranscription = true;
    await click(startLabel);
    await until(() => !button(stopLabel).disabled);
    await click(stopLabel);
    await emit(audio.nodes[2], chunk);
    await emit(audio.nodes[2], { type: 'stopped' });
    await until(() => typeof finishTranscription === 'function');
    await click('Reset session');
    assert.equal(transcriptions.at(-1).signal.aborted, true);
    await act(async () => finishTranscription(Response.json([{ start: 2, end: 3, speaker: null, text: 'Late result' }])));
    assert.equal(document.querySelector('[aria-label="Transcript"]'), null);
    assert.ok(document.body.textContent.includes('No topics yet.'));
    assert.equal(button(startLabel).disabled, false);
    assert.equal(requests.length, 3);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
