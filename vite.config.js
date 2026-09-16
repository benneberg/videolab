import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
