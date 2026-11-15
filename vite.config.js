import { defineConfig, loadEnv } from 'vite';
import { createHandler } from './api/process.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    optimizeDeps: { entries: ['index.html'] },
    server: {
      watch: { ignored: ['**/.venv*/**', '**/.cache/**'] },
      proxy: {
        '/api/transcribe': {
          target: env.TRANSCRIPTION_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('error', (_error, _request, response) => {
              if (!response.writeHead || response.headersSent) return;
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
        const handle = createHandler({ env });
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split('?')[0] !== '/api/process') return next();
          try {
            const request = new Request('http://localhost/api/process', req.method === 'POST'
              ? { method: 'POST', body: req, duplex: 'half' }
              : { method: req.method });
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
