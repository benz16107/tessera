import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { DbConnection } from './module_bindings/index.ts';
import { ConfigContext, type AppConfig } from './config.ts';
import App from './App.tsx';

// Keys and hosts come from the crew at runtime (GET /api/config) so nothing secret lands in the bundle.
function Boot() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (cfg) return;
    let stop = false;
    fetch('/api/config')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c: AppConfig) => { if (!stop) setCfg(c); })
      .catch(() => { if (!stop) setTimeout(() => setTries(t => t + 1), 3000); });
    return () => { stop = true; };
  }, [cfg, tries]);

  const builder = useMemo(() => {
    if (!cfg) return null;
    // The scout page keeps its own identity so one browser can plan and scout as two people.
    const role = location.pathname.startsWith('/s/') ? '/scout' : '';
    const key = `${cfg.spacetimeHost}/${cfg.dbName}/auth_token${role}`;
    return DbConnection.builder()
      .withUri(cfg.spacetimeHost)
      .withDatabaseName(cfg.dbName)
      .withToken(localStorage.getItem(key) ?? undefined)
      .withAutomaticReconnect()
      .onConnect((_c, _id, token) => localStorage.setItem(key, token));
  }, [cfg]);

  if (!cfg || !builder) {
    // Credits needs no backend, so it renders while the crew is down.
    if (location.pathname.startsWith('/credits')) return <App />;
    return (
      <main className="waiting" aria-live="polite">
        <p className="wordmark">Tessera</p>
        <h1>Waiting for the Tessera service</h1>
        <p>The crew service at <code>/api/config</code> is not answering yet. This page retries every 3 seconds{tries > 0 ? ` (try ${tries + 1})` : ''}.</p>
      </main>
    );
  }
  return (
    <ConfigContext.Provider value={cfg}>
      <SpacetimeDBProvider connectionBuilder={builder}>
        <App />
      </SpacetimeDBProvider>
    </ConfigContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>
);
