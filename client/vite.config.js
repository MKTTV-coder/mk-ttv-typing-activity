import { defineConfig } from 'vite';

export default defineConfig({
     root: './client', 
  server: { port: 5173, host: '0.0.0.0' },
  build: { outDir: '../dist', emptyOutDir: true },
});
