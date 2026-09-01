import { defineConfig } from 'vite';

export default defineConfig({
  // Runtime asset URLs use /assets/*; deploy this client at the origin root.
  base: '/',
  build: {
    assetsInlineLimit: 0,
  },
});
