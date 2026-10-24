import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The API port lives in ../server/.env (PORT=...). Falls back to 5000.
function getBackendPort() {
  try {
    const envPath = path.resolve(here, '../server/.env');
    if (fs.existsSync(envPath)) {
      const match = fs.readFileSync(envPath, 'utf8').match(/^PORT\s*=\s*(\d+)/m);
      if (match) return Number(match[1]);
    }
  } catch {
    /* use the default */
  }
  return 5000;
}

const backendPort = getBackendPort();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // The browser calls /api/... on the Vite origin; Vite forwards it to the Express server.
    proxy: {
      '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true },
    },
  },
});
