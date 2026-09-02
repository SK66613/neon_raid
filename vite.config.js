import { defineConfig } from 'vite';

export default defineConfig({
  // Runtime asset URLs use /assets/*; deploy this client at the origin root.
  base: '/',
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true, changeOrigin: true } },
  },
  build: {
    assetsInlineLimit: 0,
  },
});
