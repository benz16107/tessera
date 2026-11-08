// Dev server for studio work against a remote crew (the Vultr box), with Host rewriting and the /asset proxy:
//   CREW_URL=https://104-238-146-229.sslip.io npx vite --config scripts/vite.studio.ts --port 5181
// /api/config is answered locally (same shape as the crew's, CONTRACTS.md) so a crew restart doesn't stall the page.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from '../vite.config.ts';

const crew = process.env.CREW_URL ?? 'http://127.0.0.1:8790';
const to = { target: crew, changeOrigin: true, secure: true };

const localConfig = (): Plugin => ({
  name: 'studio-local-config',
  configureServer(server) {
    server.middlewares.use('/api/config', (_req, res) => {
      const mapsKey = readFileSync(`${homedir()}/.config/shotmatch/maps_key`, 'utf8').trim();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ spacetimeHost: 'wss://maincloud.spacetimedb.com', dbName: 'shotmatch', mapsKey, publicUrl: crew }));
    });
  },
});

export default mergeConfig(base, defineConfig({
  plugins: [localConfig()],
  server: { proxy: { '/api': to, '/photo': to, '/preview': to, '/spot-photo': to, '/asset': to } },
}));
