import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import config from '../vite.config.ts';

test('Vite reads the transcription target from .env.local and proxies requests and outages', async () => {
  const previousDirectory = process.cwd();
  const previousTarget = process.env.TRANSCRIPTION_URL;
  const directory = await mkdtemp(join(tmpdir(), 'micaws-proxy-'));
  const received = [];
  const backend = createHttpServer(async (request, response) => {
    let body = '';
    for await (const data of request) body += data;
    received.push({ url: request.url, method: request.method, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{ start: 10, end: 11, speaker: null, text: 'Test reply' }]));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  let frontend;
  try {
    delete process.env.TRANSCRIPTION_URL;
    const target = 'http://127.0.0.1:' + backend.address().port;
    await writeFile(join(directory, '.env.local'), 'TRANSCRIPTION_URL=' + target);
    process.chdir(directory);
    const settings = config({ mode: 'development' });
    assert.equal(settings.server.proxy['/api/transcribe'].target, target);
    frontend = await createServer({
      ...settings, configFile: false, root: previousDirectory,
      server: { ...settings.server, host: '127.0.0.1', port: 0, ws: false },
    });
    await frontend.listen();
    const url = 'http://127.0.0.1:' + frontend.httpServer.address().port + '/api/transcribe';
    const form = new FormData();
    form.append('audio', new Blob(['test-audio']), 'recording.wav');
    form.append('chunk_id', 'test-1');
    form.append('start_seconds', '10');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].start, 10);
    assert.equal(received[0].url, '/api/transcribe');
    assert.equal(received[0].method, 'POST');
    assert.match(received[0].body, /test-1/);
    assert.match(received[0].body, /recording.wav/);
    await new Promise(resolve => backend.close(resolve));
    const unavailable = await fetch(url, { method: 'POST', body: form });
    assert.equal(unavailable.status, 503);
    assert.match((await unavailable.json()).detail, /Application startup complete/);
  } finally {
    await frontend?.close();
    backend.close();
    process.chdir(previousDirectory);
    if (previousTarget === undefined) delete process.env.TRANSCRIPTION_URL;
    else process.env.TRANSCRIPTION_URL = previousTarget;
    await rm(directory, { recursive: true, force: true });
  }
});
