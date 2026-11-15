import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encodeWav } from '../src/audio/encodeWav.js';
import { MicrophoneSession } from '../src/services/microphoneSession.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const chunk = (startSample = 0, length = 160_000) => ({
  type: 'chunk', startSample, samples: new Float32Array(length), sampleRate: 16_000,
});
const segment = start => ({ id: 'test', start, end: start + 1, speaker: null, text: 'Hello' });
function session(options = {}) {
  const transcripts = [], statuses = [], errors = [];
  const recorder = new MicrophoneSession({
    onTranscript: (...args) => transcripts.push(args),
    onStatus: value => statuses.push(value),
    onError: value => errors.push(value),
    ...options,
  });
  return { recorder, transcripts, statuses, errors };
}

for (const rate of [44100, 48000]) {
  test(`worklet at ${rate} Hz emits 10s chunks and a final tail without lost samples`, () => {
    let Processor;
    const messages = [];
    const context = vm.createContext({
      sampleRate: rate,
      Float32Array,
      AudioWorkletProcessor: class {
        constructor() { this.port = { postMessage: message => messages.push(message) }; }
      },
      registerProcessor: (_, value) => { Processor = value; },
    });
    vm.runInContext(readFileSync(new URL('../src/audio/chunk-processor.js', import.meta.url), 'utf8'), context);
    const processor = new Processor();
    const original = Float32Array.from({ length: rate * 23 }, (_, i) => (i % 997) / 997);
    for (let i = 0; i < original.length; i += 128) {
      processor.process([[original.subarray(i, i + 128)]]);
    }
    processor.port.onmessage({ data: 'stop' });
    processor.port.onmessage({ data: 'stop' });
    assert.deepEqual(messages.map(message => message.type), ['chunk', 'chunk', 'chunk', 'stopped']);
    const chunks = messages.filter(message => message.type === 'chunk');
    assert.deepEqual(chunks.map(c => c.samples.length), [rate * 10, rate * 10, rate * 3]);
    assert.deepEqual(chunks.map(c => c.startSample), [0, rate * 10, rate * 20]);
    for (const c of chunks) assert.deepEqual(c.samples, original.subarray(c.startSample, c.startSample + c.samples.length));
    assert.equal(processor.process([[new Float32Array(128)]]), false);
  });
}

test('every WAV has an independent header, correct rate and clipped PCM samples', async () => {
  const wav = encodeWav(new Float32Array([-2, -1, 0, 1, 2]), 48000);
  const bytes = await wav.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(wav.type, 'audio/wav');
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767]);
});

test('uploads are ordered while capture continues; silent chunks preserve time', async t => {
  const calls = [], releases = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls.push(options);
    return await new Promise(resolve => releases.push(resolve));
  });
  const { recorder, transcripts, statuses } = session({ startSeconds: 4 });
  recorder.receive(chunk());
  recorder.receive(chunk(160_000));
  recorder.receive(chunk(320_000, 48_000));
  recorder.receive({ type: 'stopped' });
  assert.equal(calls.length, 1);
  releases.shift()(Response.json([]));
  await tick();
  assert.equal(calls.length, 2);
  releases.shift()(Response.json([segment(14)]));
  await tick();
  releases.shift()(Response.json([segment(24)]));
  await tick();
  assert.deepEqual(calls.map(call => call.body.get('start_seconds')), ['4', '14', '24']);
  assert.equal(new Set(calls.map(call => call.body.get('chunk_id'))).size, 3);
  assert.deepEqual(transcripts.map(([, end]) => end), [14, 24, 27]);
  assert.deepEqual(statuses, ['idle']);
});

test('failed audio remains queued; retry uses same ID and appends once', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_, { body }) => {
    calls.push(body);
    return calls.length === 1
      ? Response.json({ detail: 'Server unavailable.' }, { status: 503 })
      : Response.json([segment(Number(body.get('start_seconds')))]);
  });
  const { recorder, transcripts, errors, statuses } = session();
  recorder.receive(chunk());
  recorder.receive(chunk(160_000, 16_000));
  recorder.receive({ type: 'stopped' });
  await tick();
  assert.equal(recorder.queue.length, 2);
  assert.equal(transcripts.length, 0);
  assert.match(errors[0], /Audio is retained/);
  recorder.retry();
  await tick();
  assert.equal(transcripts.length, 2);
  assert.equal(recorder.queue.length, 0);
  assert.equal(calls[0].get('chunk_id'), calls[1].get('chunk_id'));
  assert.equal(statuses.at(-1), 'idle');
});

test('cancel aborts upload and ignores a late response or worklet message', async t => {
  let resolve, signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return await new Promise(done => { resolve = done; });
  });
  const { recorder, transcripts, statuses } = session();
  recorder.receive(chunk());
  recorder.cancel();
  assert.equal(signal.aborted, true);
  resolve(Response.json([segment(0)]));
  recorder.receive(chunk(160_000));
  await tick();
  assert.deepEqual(transcripts, []);
  assert.deepEqual(statuses, []);
  assert.equal(recorder.queue.length, 0);
});

test('stop requests a tail flush once and waits for its transcription', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([segment(0)]));
  const { recorder, transcripts, statuses } = session();
  const commands = [];
  let trackStops = 0;
  recorder.node = { port: { postMessage: command => commands.push(command), close() {} }, disconnect() {} };
  recorder.stream = { getTracks: () => [{ stop: () => trackStops++ }] };
  recorder.stop();
  recorder.stop();
  assert.deepEqual(commands, ['stop']);
  assert.equal(trackStops, 1);
  assert.deepEqual(statuses, ['transcribing']);
  recorder.receive(chunk(0, 16_000));
  recorder.receive({ type: 'stopped' });
  await tick();
  assert.equal(transcripts.length, 1);
  assert.deepEqual(statuses, ['transcribing', 'idle']);
});

test('permission denial returns to idle and closes the audio context', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  const { contexts } = installAudioMocks(t, {
    getUserMedia: async () => { throw new Error('Permission denied'); },
  });
  const { recorder, errors, statuses } = session();
  await recorder.start();
  assert.deepEqual(statuses, ['starting', 'idle']);
  assert.match(errors[0], /Permission denied/);
  assert.equal(contexts[0].state, 'closed');
});

test('worklet startup failure releases the granted microphone', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  const { contexts, tracks } = installAudioMocks(t, {
    addModule: async () => { throw new Error('Worklet failed'); },
  });
  const { recorder, statuses } = session();
  await recorder.start();
  assert.equal(statuses.at(-1), 'idle');
  assert.ok(tracks[0].stops > 0);
  assert.equal(contexts[0].state, 'closed');
});

test('reset during permission prompt releases a late microphone grant', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  let grant;
  const track = { stopped: false, stop() { this.stopped = true; } };
  installAudioMocks(t, { getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  const { recorder, statuses } = session();
  const starting = recorder.start();
  await tick();
  recorder.cancel();
  grant({ getTracks: () => [track] });
  await starting;
  assert.equal(track.stopped, true);
  assert.deepEqual(statuses, ['starting']);
});

test('malformed transcription items produce the validation error', async t => {
  const { transcribeAudio } = await import('../src/services/transcribeAudio.js');
  for (const item of [null, 42, { start: 0, end: 1, text: 'hello' }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json([item]));
    await assert.rejects(transcribeAudio(new Blob(['audio'])), /invalid response/);
    t.mock.restoreAll();
  }
});

test('stop cannot wait forever for an unresponsive worklet', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  const { contexts, tracks } = installAudioMocks(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { recorder, statuses, errors } = session();
  await recorder.start();
  recorder.stop();
  assert.ok(tracks[0].stops > 0);
  t.mock.timers.tick(5000);
  await tick();
  assert.equal(statuses.at(-1), 'idle');
  assert.equal(contexts[0].state, 'closed');
  assert.match(errors.at(-1), /final audio chunk/);
});

test('unsupported microphone APIs return an actionable error', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  installAudioMocks(t);
  delete globalThis.AudioWorkletNode;
  const { recorder, statuses, errors } = session();
  await recorder.start();
  assert.deepEqual(statuses, ['starting', 'idle']);
  assert.match(errors[0], /supported browser/);
});

test('reset cancels the stop watchdog and ignores late tail audio', async t => {
  const { installAudioMocks } = await import('./helpers/audio.js');
  const { nodes } = installAudioMocks(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { recorder, errors, transcripts } = session();
  await recorder.start();
  recorder.stop();
  recorder.cancel();
  nodes[0].emit(chunk());
  t.mock.timers.tick(5000);
  assert.deepEqual(errors, []);
  assert.deepEqual(transcripts, []);
  assert.equal(recorder.queue.length, 0);
});
