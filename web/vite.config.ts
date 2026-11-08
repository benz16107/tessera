import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumBuild = 'node_modules/cesium/Build/Cesium';
// CREW_URL lets a test point the dev proxy elsewhere; the crew itself is on 8790 (CONTRACTS.md).
const crew = process.env.CREW_URL ?? 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map(d => ({ src: `${cesiumBuild}/${d}`, dest: 'cesium' })),
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
    __REPO_ROOT__: JSON.stringify(fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')), // dev fixture only
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    fs: { allow: ['..'] }, // Credits reads ../spots/*/CREDITS.tsv
    proxy: { '/api': crew, '/photo': crew, '/preview': crew },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 6000 },
});
