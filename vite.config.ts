import express from 'express';
import { defineConfig, loadEnv } from 'vite';
import { createLiveRouter } from './server/live.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    optimizeDeps: { entries: ['index.html'] },
    server: {
      allowedHosts: ['micaws.us'],
      watch: { ignored: ['**/.venv*/**', '**/.cache/**'] },
      proxy: {
        '/api/v1': { target: env.SAVED_API_URL || 'http://127.0.0.1:8080', changeOrigin: true },
      },
    },
    plugins: [{
      name: 'local-meeting-api',
      configureServer(server) {
        const live = express();
        live.disable('x-powered-by');
        live.use(createLiveRouter(env));
        server.middlewares.use(live);
      },
    }],
  };
});
