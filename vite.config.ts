import { defineConfig, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { handleApi } from './api/index';

/** Serves the same /api handler as the Vercel Function during `vite` and `vite preview`. */
const api: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith('/api/')) return next();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  handleApi(new Request(`http://localhost${req.url}`, { method: req.method, headers }), {
    root: resolve('documents'),
    secret: process.env.SIGNING_SECRET || 'docscope-sample-dev-secret',
  })
    .then((response) => {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) Readable.fromWeb(response.body as never).pipe(res);
      else res.end();
    })
    .catch(next);
};

export default defineConfig({
  // The pdf.js worker is one lazily loaded ~1.3 MB chunk; it is never part of the initial load.
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [
    react(),
    {
      name: 'docscope-sample-api',
      configureServer: (server) => void server.middlewares.use(api),
      configurePreviewServer: (server) => void server.middlewares.use(api),
    },
  ],
});
