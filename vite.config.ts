import { Readable } from "node:stream";
import { defineConfig, loadEnv } from 'vite';
import { createHandler } from './api/process.js';
import { createSummaryHandler } from './api/summary.js';
import { createTranslationHandler } from './api/translate.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    optimizeDeps: { entries: ['index.html'] },
    server: {
      allowedHosts: ['micaws.us'],
      watch: { ignored: ['**/.venv*/**', '**/.cache/**'] },
      proxy: {
        '/api/v1': { target: env.SAVED_API_URL || 'http://127.0.0.1:8080', changeOrigin: true },
        '/api/transcribe': {
          target: env.TRANSCRIPTION_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('error', (_error, _request, response) => {
              if (!("writeHead" in response) || response.headersSent) return;
              response.writeHead(503, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify({
                detail: 'The transcription server is unavailable or still loading. Start the Python server on port 8000 and wait for Application startup complete, then retry.',
              }));
            });
          },
        },
      },
    },
    plugins: [{
      name: 'local-meeting-api',
      configureServer(server) {
        // /api/process = mind map updates, /api/summary = end-of-meeting summary
        const handlers: Record<string, (request: Request) => Promise<Response>> = { '/api/process': createHandler({ env }), '/api/summary': createSummaryHandler({ env }), '/api/translate': createTranslationHandler({ env }) };
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split('?')[0];
          const handle = path && handlers[path];
          if (!handle) return next();
          try {
            const init: RequestInit & { duplex?: 'half' } = req.method === 'POST'
              ? { method: 'POST', body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' }
              : { method: req.method };
            const request = new Request('http://localhost' + path, init);
            const response = await handle(request);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Local processing server failed.' }));
          }
        });
      },
    }],
  };
});
