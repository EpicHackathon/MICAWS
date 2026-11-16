import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordingArchive, ARCHIVE_RATE } from '../src/audio/recordingArchive.js';
import { MicrophoneSession } from '../src/services/microphoneSession.js';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useMicrophone } from '../src/hooks/useMicrophone.js';
import { installAudioMocks } from './helpers/audio.js';

test('recording WAV preserves timing across rate changes, silence gaps and final partial chunks', async () => {
  const archive = new RecordingArchive();
  archive.append(new Float32Array(48000).fill(0.5), 48000, 0);
  archive.append(new Float32Array(8000).fill(-0.5), 16000, 2);
  const data = new DataView(await archive.toBlob().arrayBuffer());
  assert.equal(archive.duration, 2.5);
  assert.equal(data.getUint32(24, true), ARCHIVE_RATE);
  assert.equal(data.getUint32(40, true), 2.5 * ARCHIVE_RATE * 2);
  assert.equal(data.getInt16(44, true), 16384);
  assert.equal(data.getInt16(44 + 16000 * 2, true), 0);
  assert.equal(data.getInt16(44 + 32000 * 2, true), -16384);
  assert.equal(data.byteLength, 44 + data.getUint32(40, true));
});

test('recording archive rejects overlap and storage overflow without losing earlier audio', async () => {
  const archive = new RecordingArchive(32000);
  archive.append(new Float32Array(16000), 16000, 0);
  assert.throws(() => archive.append(new Float32Array(1), 16000, 0), /overlaps/);
  assert.throws(() => archive.append(new Float32Array(1), 16000, 1), /storage is full/);
  assert.equal(archive.duration, 1);
  assert.equal(archive.toBlob().size, 32044);
});

test('audio retention occurs once before upload and language stays fixed across retries', async t => {
  const calls = [], saved = [], transcript = [];
  t.mock.method(globalThis, 'fetch', async (_, { body }) => {
    calls.push(body);
    return calls.length === 1 ? Response.json({ detail: 'Unavailable' }, { status: 503 }) : Response.json([]);
  });
  const recorder = new MicrophoneSession({ language: 'es', onTranscript: item => transcript.push(item), onStatus() {}, onError() {}, onAudioChunk: (...args) => saved.push(args) });
  t.after(() => recorder.cancel());
  recorder.receive({ type: 'chunk', startSample: 0, sampleRate: 16000, samples: new Float32Array(16000) });
  await new Promise(resolve => setImmediate(resolve));
  recorder.retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.length, 1);
  assert.equal(transcript.length, 1);
  assert.deepEqual(calls.map(body => body.get('language')), ['es', 'es']);
  assert.equal(calls[0].get('chunk_id'), calls[1].get('chunk_id'));
});

test('playback seeks on the transcript timeline and reset/unmount revoke retained URLs', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const original = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let current;
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const audio = installAudioMocks(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  let count = 0;
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => `blob:recording-${++count}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  function Probe() { current = useMicrophone(() => {}, { language: 'es' }); return null; }
  await act(() => root.render(React.createElement(Probe)));
  async function record() {
    await act(() => current.start());
    await act(async () => {
      const node = audio.nodes.at(-1);
      node.emit({ type: 'chunk', startSample: 0, sampleRate: 16000, samples: new Float32Array(16000) });
      current.stop();
      node.emit({ type: 'stopped' });
      await new Promise(resolve => setImmediate(resolve));
    });
  }
  await record();
  assert.equal(current.recording.duration, 1);
  let played = false;
  current.audioRef.current = { currentTime: 0, play: async () => { played = true; } };
  current.seek(0.5);
  assert.equal(current.audioRef.current.currentTime, 0.5);
  assert.equal(played, true);
  await record();
  assert.equal(current.recording.duration, 2);
  assert.deepEqual(revoked, ['blob:recording-1']);
  await act(() => current.reset());
  assert.equal(current.hasRecording, false);
  assert.equal(current.recording, null);
  assert.deepEqual(revoked, ['blob:recording-1', 'blob:recording-2']);
  await record();
  await act(() => root.unmount());
  assert.ok(revoked.includes('blob:recording-3'));
});
