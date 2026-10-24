import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()], cacheDir: 'node_modules/.vite-S0',
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: false } } },
  build: { outDir: 'dist/web', emptyOutDir: true }
});
