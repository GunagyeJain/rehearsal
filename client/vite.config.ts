import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// @rehearsal/shared is TypeScript source (exports -> src/index.ts). The alias pins it to the
// workspace source so Vite and Vitest transform it like app code, with no build step.
const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

// API_PORT lets a second server instance run beside a stray one on 4000 (defaults to 4000).
const apiProxy = {
  target: `http://127.0.0.1:${process.env.API_PORT ?? '4000'}`,
  changeOrigin: false,
  // Append the real peer to X-Forwarded-For, so a server with TRUST_PROXY=1 never uses a client-sent value.
  xfwd: true,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@rehearsal/shared': sharedEntry },
  },
  // `vite preview` (the production build) proxies /api the same way, for build-time checks.
  preview: { proxy: { '/api': apiProxy } },
  server: {
    port: 5173,
    proxy: { '/api': apiProxy },
  },
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
