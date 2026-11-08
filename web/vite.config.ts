import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CREW_URL lets a test point the dev proxy elsewhere; the crew itself is on 8790 (CONTRACTS.md).
const crew = process.env.CREW_URL ?? 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    fs: { allow: ['..'] }, // Credits reads ../spots/*/CREDITS.tsv
    proxy: { '/api': crew, '/photo': crew, '/preview': crew, '/spot-photo': crew },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 6000 },
});
